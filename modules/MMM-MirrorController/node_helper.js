const NodeHelper = require("node_helper");
const Log = require("logger");

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile, spawn } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const DATA_DIR = path.join(os.homedir(), ".config", "anthony-magic-mirror");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const API_KEY_FILE = path.join(DATA_DIR, "openai_api_key");

const voiceInputFile = (turnId) =>
  path.join(os.tmpdir(), `anthony-mirror-input-${turnId}.wav`);

const voiceOutputFile = (turnId) =>
  path.join(os.tmpdir(), `anthony-mirror-output-${turnId}.wav`);

module.exports = NodeHelper.create({
  start() {
    Log.log("[MMM-MirrorController] Backend starting...");

    this.voiceBusy = false;
    this.activeTurnId = 0;
    this.activePlaybackProcess = null;
    this.lastResponseId = null;
    this.selectedStoryTitle = "";

    this.ensurePrivateStorage();
    this.prepareAudio().catch((error) => {
      Log.warn(
        "[MMM-MirrorController] Audio preparation warning:",
        error.message
      );
    });

    Log.log("[MMM-MirrorController] Backend ready.");
  },

  ensurePrivateStorage() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    }

    try {
      fs.chmodSync(DATA_DIR, 0o700);
    } catch (error) {
      Log.warn("[MMM-MirrorController] Could not change storage permissions.");
    }
  },

  getDefaultSettings() {
    return {
      userName: "",
      mirrorName: "HAL",
      location: "Clovis, New Mexico",
      voice: "hal",
      model: "auto"
    };
  },

  loadSettings() {
    const defaults = this.getDefaultSettings();
    if (!fs.existsSync(SETTINGS_FILE)) return defaults;

    try {
      return {
        ...defaults,
        ...JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"))
      };
    } catch (error) {
      Log.error("[MMM-MirrorController] Could not read settings:", error);
      return defaults;
    }
  },

  saveSettings(payload = {}) {
    const settings = {
      userName: String(payload.userName || "").trim(),
      mirrorName: String(payload.mirrorName || "HAL").trim(),
      location: String(payload.location || "Clovis, New Mexico").trim(),
      voice: String(payload.voice || "hal").trim(),
      model: String(payload.model || "auto").trim()
    };

    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), {
      encoding: "utf8",
      mode: 0o600
    });
    fs.chmodSync(SETTINGS_FILE, 0o600);

    return settings;
  },

  saveApiKey(apiKey) {
    if (typeof apiKey !== "string" || !apiKey.trim()) return false;

    fs.writeFileSync(API_KEY_FILE, apiKey.trim(), {
      encoding: "utf8",
      mode: 0o600
    });
    fs.chmodSync(API_KEY_FILE, 0o600);

    return true;
  },

  loadApiKey() {
    if (!fs.existsSync(API_KEY_FILE)) return "";
    return fs.readFileSync(API_KEY_FILE, "utf8").trim();
  },

  apiKeyConfigured() {
    try {
      return this.loadApiKey().length > 0;
    } catch (error) {
      return false;
    }
  },

  getSetupState() {
    const settings = this.loadSettings();
    return {
      settings,
      apiKeyConfigured: this.apiKeyConfigured(),
      setupComplete: Boolean(settings.userName && settings.mirrorName)
    };
  },

  async findWm8960Card() {
    for (const command of ["arecord", "aplay"]) {
      try {
        const { stdout = "", stderr = "" } = await execFileAsync(
          command,
          ["-l"],
          { encoding: "utf8" }
        );
        const match = `${stdout}\n${stderr}`.match(
          /card\s+(\d+):\s+wm8960soundcard/i
        );
        if (match) return Number(match[1]);
      } catch (error) {
        // Try the other ALSA command.
      }
    }

    throw new Error("WM8960 audio HAT was not found.");
  },

  async setMixer(card, controlName, value) {
    try {
      await execFileAsync(
        "amixer",
        ["-c", String(card), "cset", `name=${controlName}`, value],
        { encoding: "utf8" }
      );
      return true;
    } catch (error) {
      Log.warn(`[MMM-MirrorController] Mixer control skipped: ${controlName}`);
      return false;
    }
  },

  async prepareAudio() {
    const card = await this.findWm8960Card();
    this.audioCard = card;

    const controls = [
      ["Left Output Mixer PCM Playback Switch", "on"],
      ["Right Output Mixer PCM Playback Switch", "on"],
      ["Playback Volume", "255,255"],
      ["Speaker Playback Volume", "109,109"],
      ["Speaker DC Volume", "4"],
      ["Speaker AC Volume", "4"],
      ["Capture Switch", "on,on"],
      ["Capture Volume", "55,55"],
      ["ADC PCM Capture Volume", "220,220"],
      ["Left Boost Mixer LINPUT1 Switch", "on"],
      ["Right Boost Mixer RINPUT1 Switch", "on"],
      ["Left Input Mixer Boost Switch", "on"],
      ["Right Input Mixer Boost Switch", "on"]
    ];

    for (const [name, value] of controls) {
      await this.setMixer(card, name, value);
    }

    Log.log(`[MMM-MirrorController] WM8960 ready as ALSA card ${card}.`);
    return card;
  },

  async getAudioCard() {
    if (Number.isInteger(this.audioCard)) return this.audioCard;
    return this.prepareAudio();
  },

  sendVoiceStatus(message, options = {}) {
    this.sendSocketNotification("MIRROR_VOICE_STATUS", {
      message,
      busy: options.busy ?? this.voiceBusy,
      replaceCaption: options.replaceCaption ?? true,
      phase: options.phase || ""
    });
  },

  isTurnCurrent(turnId) {
    return turnId === this.activeTurnId;
  },

  cleanupVoiceFiles(turnId) {
    for (const file of [voiceInputFile(turnId), voiceOutputFile(turnId)]) {
      try {
        fs.rmSync(file, { force: true });
      } catch (error) {
        // Temp cleanup should never break a voice turn.
      }
    }
  },

  async stopPlayback() {
    const child = this.activePlaybackProcess;
    if (!child) return;

    this.activePlaybackProcess = null;

    if (child.exitCode !== null) return;

    await new Promise((resolve) => {
      let finished = false;
      let forceTimer;
      let safetyTimer;

      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(forceTimer);
        clearTimeout(safetyTimer);
        resolve();
      };

      child.once("close", finish);

      try {
        child.kill("SIGTERM");
      } catch (error) {
        finish();
        return;
      }

      forceTimer = setTimeout(() => {
        try {
          if (child.exitCode === null) child.kill("SIGKILL");
        } catch (error) {
          // Process may already be gone.
        }
      }, 400);

      safetyTimer = setTimeout(finish, 1000);
    });
  },

  async interruptVoiceAndListen() {
    /*
     * Only speech playback is interruptible. Recording stays on the old,
     * reliable timed arecord path so it cannot be orphaned by an interruption.
     */
    if (!this.activePlaybackProcess) {
      this.sendVoiceStatus("Still working...", {
        busy: true,
        replaceCaption: false
      });
      return;
    }

    Log.log("[MMM-MirrorController] Interrupting speech playback.");

    this.activeTurnId += 1;
    await this.stopPlayback();
    this.voiceBusy = false;

    this.sendVoiceStatus("Listening...", {
      busy: true,
      phase: "listening"
    });

    setTimeout(() => this.handleVoiceRequest(), 100);
  },

  async recordVoice(turnId) {
    const card = await this.getAudioCard();
    if (!this.isTurnCurrent(turnId)) return "";

    const inputFile = voiceInputFile(turnId);
    fs.rmSync(inputFile, { force: true });

    /*
     * Keep recording simple. This is the same style that was stable before
     * interruption support was added. execFile owns the process and enforces
     * a hard timeout so a recorder cannot live forever and hold the mic open.
     */
    await execFileAsync(
      "arecord",
      [
        "-D", `hw:${card},0`,
        "-f", "S32_LE",
        "-r", "16000",
        "-c", "2",
        "-d", "8",
        inputFile
      ],
      {
        encoding: "utf8",
        timeout: 12000,
        killSignal: "SIGKILL"
      }
    );

    if (!this.isTurnCurrent(turnId)) return "";
    if (!fs.existsSync(inputFile)) {
      throw new Error("The microphone recording was not created.");
    }

    return inputFile;
  },

  async transcribeAudio(filePath, apiKey) {
    const form = new FormData();
    form.append("model", "gpt-4o-mini-transcribe");
    form.append("language", "en");
    form.append(
      "file",
      new Blob([fs.readFileSync(filePath)], { type: "audio/wav" }),
      "mirror-question.wav"
    );

    const response = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form
      }
    );
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.error?.message || "OpenAI transcription failed.");
    }

    return String(data?.text || "").trim();
  },

  chooseTextModel(settings) {
    if (settings.model && settings.model !== "auto") return settings.model;
    return "gpt-5-mini";
  },

  getMirrorTools() {
    return [
      {
        type: "web_search",
        search_context_size: "low",
        user_location: {
          type: "approximate",
          city: "Clovis",
          region: "New Mexico",
          country: "US",
          timezone: "America/Denver"
        }
      },
      {
        type: "function",
        name: "set_weather",
        description:
          "Update the current temperature and rain chance shown in the top-right corner of the mirror. Use after finding current weather information.",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            temperature: { type: "string" },
            rainChance: { type: "string" }
          },
          required: ["temperature", "rainChance"],
          additionalProperties: false
        }
      },
      {
        type: "function",
        name: "set_daily_buzz",
        description:
          "Replace the short Daily Buzz prompts shown in the right rail.",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            items: {
              type: "array",
              minItems: 3,
              maxItems: 7,
              items: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  title: { type: "string" },
                  detail: { type: "string" }
                },
                required: ["category", "title", "detail"],
                additionalProperties: false
              }
            }
          },
          required: ["items"],
          additionalProperties: false
        }
      },
      {
        type: "function",
        name: "show_center",
        description: "Show longer information in the center of the mirror.",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            title: { type: "string" },
            body: { type: "string" }
          },
          required: ["title", "body"],
          additionalProperties: false
        }
      },
      {
        type: "function",
        name: "clear_center",
        description: "Clear temporary information from the center of the mirror.",
        strict: true,
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false
        }
      },
      {
        type: "function",
        name: "set_caption",
        description: "Change the short caption shown at the bottom of the mirror.",
        strict: true,
        parameters: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
          additionalProperties: false
        }
      }
    ];
  },

  getAssistantInstructions(settings) {
    const userName = settings.userName || "the user";
    const mirrorName = settings.mirrorName || "HAL";
    const location = settings.location || "Clovis, New Mexico";

    return [
      `You are ${mirrorName}, an intelligent voice assistant controlling a smart mirror for ${userName}.`,
      `The user's saved location is ${location}.`,
      "Answer the user's actual question directly.",
      "Use the safe display tools whenever the request should visibly change the mirror.",
      "For current weather, temperature, rain, forecast, or current news, use web search.",
      "After finding current temperature, also call set_weather.",
      "If asked to load, refresh, show, update, or create the Daily Buzz, search current news first and then call set_daily_buzz.",
      "Daily Buzz items belong on the right side and should be short curiosity prompts, not full summaries.",
      "Aim for about 5 or 6 Daily Buzz items.",
      "Include one short Scripture item, preferably KJV wording or a Scripture reference.",
      "Include important current news and a New Mexico or local item when meaningful.",
      "Other items may cover faith, science, technology, culture, or other interesting developments.",
      "Avoid sports unless specifically requested.",
      "Use show_center for longer displayed information and clear_center to dismiss it.",
      "Keep ordinary spoken answers concise and lead with the main answer.",
      "Do not claim you changed the mirror unless you actually called the corresponding tool.",
      "Do not claim current information was searched unless web search was used.",
      "Sound calm, restrained, intelligent, practical, and conversational."
    ].join(" ");
  },

  extractResponseText(data) {
    if (typeof data?.output_text === "string" && data.output_text.trim()) {
      return data.output_text.trim();
    }

    const pieces = [];
    for (const item of data?.output || []) {
      for (const content of item?.content || []) {
        if (content?.type === "output_text" && content?.text) {
          pieces.push(content.text);
        }
      }
    }
    return pieces.join("\n").trim();
  },

  getFunctionCalls(data) {
    return (data?.output || []).filter((item) => item?.type === "function_call");
  },

  executeMirrorTool(name, args = {}) {
    switch (name) {
      case "set_weather":
        this.sendSocketNotification("MIRROR_SCREEN_ACTION", {
          type: "set_weather",
          temperature: String(args.temperature || "--°F"),
          rainChance: String(args.rainChance || "--%")
        });
        return { success: true, message: "Weather display updated." };

      case "set_daily_buzz": {
        const items = Array.isArray(args.items)
          ? args.items
              .slice(0, 7)
              .map((item) => ({
                category: String(item?.category || "buzz"),
                title: String(item?.title || "").trim(),
                detail: String(item?.detail || "").trim()
              }))
              .filter((item) => item.title)
          : [];

        if (!items.length) {
          return { success: false, message: "No Daily Buzz items were provided." };
        }

        this.sendSocketNotification("MIRROR_SCREEN_ACTION", {
          type: "set_daily_buzz",
          items
        });
        return { success: true, itemCount: items.length };
      }

      case "show_center":
        this.sendSocketNotification("MIRROR_SCREEN_ACTION", {
          type: "show_center",
          title: String(args.title || ""),
          body: String(args.body || "")
        });
        return { success: true };

      case "clear_center":
        this.sendSocketNotification("MIRROR_SCREEN_ACTION", {
          type: "clear_center"
        });
        return { success: true };

      case "set_caption":
        this.sendSocketNotification("MIRROR_SCREEN_ACTION", {
          type: "set_caption",
          text: String(args.text || "")
        });
        return { success: true };

      default:
        return { success: false, message: `Unknown mirror tool: ${name}` };
    }
  },

  async sendOpenAIResponseRequest(apiKey, body) {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.error?.message || "OpenAI response failed.");
    }
    return data;
  },

  async askOpenAI(transcript, apiKey, settings, turnId) {
    const userInput = this.selectedStoryTitle
      ? `Currently selected Daily Buzz item: "${this.selectedStoryTitle}".\nUser said: ${transcript}`
      : transcript;

    const tools = this.getMirrorTools();
    const instructions = this.getAssistantInstructions(settings);
    const request = {
      model: this.chooseTextModel(settings),
      instructions,
      input: userInput,
      tools,
      tool_choice: "auto",
      reasoning: { effort: "low" },
      max_output_tokens: 1600
    };

    if (this.lastResponseId) request.previous_response_id = this.lastResponseId;

    let data = await this.sendOpenAIResponseRequest(apiKey, request);
    if (!this.isTurnCurrent(turnId)) return "";

    for (let round = 0; round < 5; round += 1) {
      const calls = this.getFunctionCalls(data);

      if (!calls.length) {
        if (data?.id && this.isTurnCurrent(turnId)) this.lastResponseId = data.id;
        return this.extractResponseText(data) || "Done.";
      }

      const toolOutputs = [];
      for (const call of calls) {
        if (!this.isTurnCurrent(turnId)) return "";

        let args = {};
        try {
          args = JSON.parse(call.arguments || "{}");
        } catch (error) {
          // Invalid tool arguments become an empty object.
        }

        Log.log(`[MMM-MirrorController] HAL tool: ${call.name}`);
        toolOutputs.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify(this.executeMirrorTool(call.name, args))
        });
      }

      data = await this.sendOpenAIResponseRequest(apiKey, {
        model: this.chooseTextModel(settings),
        instructions,
        previous_response_id: data.id,
        input: toolOutputs,
        tools,
        tool_choice: "auto",
        reasoning: { effort: "low" },
        max_output_tokens: 1600
      });

      if (!this.isTurnCurrent(turnId)) return "";
    }

    throw new Error("HAL used too many screen-control steps without finishing.");
  },

  cleanCaptionText(text) {
    return String(text || "")
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
      .replace(/https?:\/\/\S+/gi, "")
      .replace(/[^]*/g, "")
      .replace(/[*_`#>~-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  },

  makeCaption(text, maxLength = 180) {
    const clean = this.cleanCaptionText(text);
    if (!clean) return "Done.";
    if (clean.length <= maxLength) return clean;

    const sentences = clean.match(/[^.!?]+[.!?]+/g) || [];
    let summary = "";

    for (const sentence of sentences.slice(0, 2)) {
      const candidate = `${summary} ${sentence}`.trim();
      if (candidate.length > maxLength) break;
      summary = candidate;
    }

    if (summary.length >= 45) return summary;

    const clipped = clean.slice(0, maxLength - 1);
    const lastSpace = clipped.lastIndexOf(" ");
    return `${(lastSpace > 80 ? clipped.slice(0, lastSpace) : clipped).trim()}…`;
  },

  getVoiceInstructions(settings) {
    switch (settings.voice) {
      case "warm":
        return "Speak warmly and naturally, with an easy conversational pace.";
      case "direct":
        return "Speak clearly, firmly, and efficiently.";
      case "formal":
        return "Speak in a composed, formal, precise manner.";
      case "natural":
        return "Speak naturally and conversationally.";
      default:
        return "Speak in a calm, deliberate, restrained, measured tone with subtle pauses. Sound intelligent and composed. Do not imitate any specific actor or fictional character.";
    }
  },

  async createSpeech(text, apiKey, settings, turnId) {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: "onyx",
        input: text.slice(0, 3500),
        instructions: this.getVoiceInstructions(settings),
        response_format: "wav",
        speed: 0.95
      })
    });

    if (!response.ok) {
      let message = "OpenAI speech generation failed.";
      try {
        const data = await response.json();
        message = data?.error?.message || message;
      } catch (error) {
        // Keep the generic message.
      }
      throw new Error(message);
    }

    const outputFile = voiceOutputFile(turnId);
    fs.writeFileSync(outputFile, Buffer.from(await response.arrayBuffer()));
    return outputFile;
  },

  async playSpeech(filePath, turnId) {
    const card = await this.getAudioCard();
    if (!this.isTurnCurrent(turnId)) return;

    await new Promise((resolve, reject) => {
      const child = spawn("aplay", ["-D", `plughw:${card},0`, filePath], {
        stdio: ["ignore", "ignore", "pipe"]
      });

      this.activePlaybackProcess = child;
      let stderr = "";

      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.once("error", (error) => {
        if (this.activePlaybackProcess === child) this.activePlaybackProcess = null;
        reject(error);
      });

      child.once("close", (code, signal) => {
        if (this.activePlaybackProcess === child) this.activePlaybackProcess = null;
        if (!this.isTurnCurrent(turnId) || code === 0) {
          resolve();
          return;
        }

        reject(
          new Error(
            `Audio playback stopped unexpectedly${signal ? ` (${signal})` : ""}${stderr ? `: ${stderr.trim()}` : "."}`
          )
        );
      });
    });
  },

  async handleVoiceRequest() {
    if (this.voiceBusy) return;

    const turnId = ++this.activeTurnId;
    this.voiceBusy = true;

    try {
      const apiKey = this.loadApiKey();
      if (!apiKey) throw new Error("OpenAI API key is not configured.");

      const settings = this.loadSettings();
      this.sendVoiceStatus("Listening...", { busy: true, phase: "listening" });

      const audioPath = await this.recordVoice(turnId);
      if (!this.isTurnCurrent(turnId)) return;

      this.sendVoiceStatus("Transcribing...", { busy: true, phase: "transcribing" });
      const transcript = await this.transcribeAudio(audioPath, apiKey);
      if (!this.isTurnCurrent(turnId)) return;
      if (!transcript) throw new Error("I did not hear any speech.");

      this.sendVoiceStatus(`You: ${transcript}`, { busy: true, phase: "thinking" });
      const answer = await this.askOpenAI(
        transcript,
        apiKey,
        settings,
        turnId
      );
      if (!this.isTurnCurrent(turnId)) return;

      this.sendSocketNotification("MIRROR_VOICE_RESULT", {
        transcript,
        response: answer,
        caption: this.makeCaption(answer)
      });

      const speechPath = await this.createSpeech(answer, apiKey, settings, turnId);
      if (!this.isTurnCurrent(turnId)) return;

      this.sendVoiceStatus("", {
        busy: true,
        replaceCaption: false,
        phase: "speaking"
      });

      await this.playSpeech(speechPath, turnId);
      if (!this.isTurnCurrent(turnId)) return;

      this.voiceBusy = false;
      this.sendVoiceStatus("", {
        busy: false,
        replaceCaption: false,
        phase: "idle"
      });
    } catch (error) {
      if (!this.isTurnCurrent(turnId)) return;

      this.voiceBusy = false;
      Log.error("[MMM-MirrorController] Voice request failed:", error);
      this.sendSocketNotification("MIRROR_VOICE_ERROR", {
        error: error?.message || "Voice request failed."
      });
    } finally {
      this.cleanupVoiceFiles(turnId);
    }
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "MIRROR_PING") {
      this.sendSocketNotification("MIRROR_PONG", { message: "Backend is alive." });
      return;
    }

    if (notification === "MIRROR_GET_SETUP") {
      this.sendSocketNotification("MIRROR_SETUP_STATE", this.getSetupState());
      return;
    }

    if (notification === "MIRROR_SAVE_SETUP") {
      try {
        const settings = this.saveSettings(payload || {});
        if (payload?.apiKey) this.saveApiKey(payload.apiKey);

        this.sendSocketNotification("MIRROR_SETUP_SAVED", {
          success: true,
          settings,
          apiKeyConfigured: this.apiKeyConfigured()
        });
      } catch (error) {
        Log.error("[MMM-MirrorController] Setup save failed:", error);
        this.sendSocketNotification("MIRROR_SETUP_SAVED", {
          success: false,
          error: "Could not save mirror setup."
        });
      }
      return;
    }

    if (notification === "MIRROR_SELECT_STORY") {
      this.selectedStoryTitle = String(payload?.title || "").trim();
      return;
    }

    if (notification === "MIRROR_INTERRUPT_VOICE") {
      this.interruptVoiceAndListen().catch((error) => {
        Log.error("[MMM-MirrorController] Interrupt failed:", error);
      });
      return;
    }

    if (notification === "MIRROR_START_VOICE") {
      this.handleVoiceRequest();
    }
  }
});

/*
===============================================================================
NOTES TO A NEWBIE PROGRAMMER
===============================================================================

VOICE RECORDING
---------------
The microphone uses a simple timed arecord command. It is intentionally NOT a
long-lived spawned process. execFile applies a hard timeout so a failed recorder
cannot stay alive forever and keep the WM8960 microphone locked.

INTERRUPTION
------------
Only HAL's SPEECH PLAYBACK is interruptible. aplay is spawned because we need a
process handle to stop it. HAL waits for aplay to actually close before opening
the microphone for the next question.

SHORT BOTTOM CAPTIONS
---------------------
HAL speaks the full answer. makeCaption() creates a short version for the bottom
of the mirror, so the response bar stays readable.

TEMP FILES
----------
Each voice turn gets its own temporary input/output WAV files. They are removed
when that turn finishes, fails, or becomes stale.

===============================================================================
*/
