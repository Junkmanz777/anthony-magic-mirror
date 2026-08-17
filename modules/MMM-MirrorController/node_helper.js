const NodeHelper = require("node_helper");
const Log = require("logger");

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile, spawn } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const DATA_DIR = path.join(
  os.homedir(),
  ".config",
  "anthony-magic-mirror"
);

const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const API_KEY_FILE = path.join(DATA_DIR, "openai_api_key");
function voiceInputFile(turnId) {
  return path.join(os.tmpdir(), `anthony-mirror-input-${turnId}.wav`);
}

function voiceOutputFile(turnId) {
  return path.join(os.tmpdir(), `anthony-mirror-output-${turnId}.wav`);
}


module.exports = NodeHelper.create({
  start() {
    Log.log("[MMM-MirrorController] Backend starting...");

    this.voiceBusy = false;
    this.activeTurnId = 0;
    this.activeRecordProcess = null;
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
      fs.mkdirSync(DATA_DIR, {
        recursive: true,
        mode: 0o700
      });
    }

    try {
      fs.chmodSync(DATA_DIR, 0o700);
    } catch (error) {
      Log.warn(
        "[MMM-MirrorController] Could not change storage permissions."
      );
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
      const stored = JSON.parse(
        fs.readFileSync(SETTINGS_FILE, "utf8")
      );

      return {
        ...defaults,
        ...stored
      };
    } catch (error) {
      Log.error(
        "[MMM-MirrorController] Could not read settings:",
        error
      );
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

    fs.writeFileSync(
      SETTINGS_FILE,
      JSON.stringify(settings, null, 2),
      {
        encoding: "utf8",
        mode: 0o600
      }
    );

    fs.chmodSync(SETTINGS_FILE, 0o600);
    return settings;
  },

  saveApiKey(apiKey) {
    if (typeof apiKey !== "string" || apiKey.trim() === "") {
      return false;
    }

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
    const attempts = [
      ["arecord", ["-l"]],
      ["aplay", ["-l"]]
    ];

    for (const [command, args] of attempts) {
      try {
        const { stdout = "", stderr = "" } = await execFileAsync(
          command,
          args,
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
        [
          "-c",
          String(card),
          "cset",
          `name=${controlName}`,
          value
        ],
        { encoding: "utf8" }
      );
      return true;
    } catch (error) {
      Log.warn(
        `[MMM-MirrorController] Mixer control skipped: ${controlName}`
      );
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

    Log.log(
      `[MMM-MirrorController] WM8960 ready as ALSA card ${card}.`
    );

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

  stopChildProcess(child) {
    if (!child) return;

    try {
      child.kill("SIGTERM");
    } catch (error) {
      // The process may already have exited.
    }
  },

  cancelActiveVoiceTurn() {
    /*
     * Incrementing activeTurnId makes every old asynchronous continuation stale.
     * That prevents an interrupted answer from suddenly resuming later.
     */
    this.activeTurnId += 1;

    this.stopChildProcess(this.activeRecordProcess);
    this.stopChildProcess(this.activePlaybackProcess);

    this.activeRecordProcess = null;
    this.activePlaybackProcess = null;
    this.voiceBusy = false;
  },

  interruptVoiceAndListen() {
    Log.log("[MMM-MirrorController] Interrupting active voice turn.");

    this.cancelActiveVoiceTurn();

    this.sendVoiceStatus("Listening...", {
      busy: true,
      phase: "listening"
    });

    setTimeout(() => {
      this.handleVoiceRequest();
    }, 120);
  },

  async recordVoice(turnId) {
    const card = await this.getAudioCard();

    if (!this.isTurnCurrent(turnId)) return "";

    const inputFile = voiceInputFile(turnId);

    try {
      fs.rmSync(inputFile, { force: true });
    } catch (error) {
      // Fine if the old file does not exist.
    }

    await new Promise((resolve, reject) => {
      const child = spawn(
        "arecord",
        [
          "-D",
          `hw:${card},0`,
          "-f",
          "S32_LE",
          "-r",
          "16000",
          "-c",
          "2",
          "-d",
          "8",
          inputFile
        ],
        {
          stdio: ["ignore", "ignore", "pipe"]
        }
      );

      this.activeRecordProcess = child;
      let stderr = "";

      if (child.stderr) {
        child.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
        });
      }

      child.on("error", (error) => {
        if (this.activeRecordProcess === child) {
          this.activeRecordProcess = null;
        }
        reject(error);
      });

      child.on("close", (code, signal) => {
        if (this.activeRecordProcess === child) {
          this.activeRecordProcess = null;
        }

        if (!this.isTurnCurrent(turnId)) {
          resolve();
          return;
        }

        if (code === 0) {
          resolve();
          return;
        }

        reject(
          new Error(
            `Microphone recording stopped unexpectedly${signal ? ` (${signal})` : ""}${stderr ? `: ${stderr.trim()}` : "."}`
          )
        );
      });
    });

    if (!this.isTurnCurrent(turnId)) return "";

    if (!fs.existsSync(inputFile)) {
      throw new Error("The microphone recording was not created.");
    }

    return inputFile;
  },

  async transcribeAudio(filePath, apiKey) {
    const audio = fs.readFileSync(filePath);
    const form = new FormData();

    form.append("model", "gpt-4o-mini-transcribe");
    form.append("language", "en");
    form.append(
      "file",
      new Blob([audio], { type: "audio/wav" }),
      "mirror-question.wav"
    );

    const response = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`
        },
        body: form
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message || "OpenAI transcription failed."
      );
    }

    return String(data?.text || "").trim();
  },

  chooseTextModel(settings) {
    if (settings.model && settings.model !== "auto") {
      return settings.model;
    }
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
            temperature: {
              type: "string",
              description:
                "Current temperature including unit, for example 82°F."
            },
            rainChance: {
              type: "string",
              description:
                "Current or near-term precipitation chance including percent sign, for example 20%."
            }
          },
          required: ["temperature", "rainChance"],
          additionalProperties: false
        }
      },
      {
        type: "function",
        name: "set_daily_buzz",
        description:
          "Replace the short Daily Buzz prompts shown in the right rail. These should be short curiosity-provoking prompts the user may want to ask about, not long summaries.",
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
                  category: {
                    type: "string",
                    description:
                      "A short category such as scripture, world, US, New Mexico, Clovis, faith, science, or interest."
                  },
                  title: {
                    type: "string",
                    description:
                      "A very short line for the right rail, preferably under 10 words."
                  },
                  detail: {
                    type: "string",
                    description:
                      "A compact explanation held behind the headline for when the user clicks it or asks about it."
                  }
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
        description:
          "Show longer information in the large center portion of the mirror.",
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
        description:
          "Clear temporary information from the center of the mirror and return it to an open mirror area.",
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
        description:
          "Change the short caption shown at the bottom of the mirror.",
        strict: true,
        parameters: {
          type: "object",
          properties: {
            text: { type: "string" }
          },
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
      "You control the mirror through safe display tools.",
      "Use those tools whenever the user's request should visibly change the mirror.",
      "For current weather, temperature, rain, or forecast questions, use web search.",
      "When you obtain the current temperature, also call set_weather so the top-right display stays useful.",
      "If the user asks to load, refresh, show, update, or create the Daily Buzz, use web search for current news first and then call set_daily_buzz.",
      "Daily Buzz items belong on the RIGHT SIDE of the mirror.",
      "Daily Buzz titles should be short prompts that invite the user to ask about them, not full summaries.",
      "Aim for about 5 or 6 Daily Buzz items.",
      "Include one short Scripture item, preferably KJV wording or a Scripture reference.",
      "Include important current news when relevant.",
      "Include at least one New Mexico or local-area item when a meaningful current story exists.",
      "Other items can reflect faith, science, technology, culture, or other genuinely interesting developments.",
      "Avoid sports unless the user specifically asks for sports.",
      "The detail field should contain enough context that the item can later be expanded.",
      "Use show_center when information is too long for the five-line bottom caption or when the user asks to display something.",
      "Use clear_center when the user asks to clear, close, hide, dismiss, or return to the mirror.",
      "Keep ordinary spoken answers concise unless more detail is useful.",
      "Lead with the main answer so a short display caption can be made from the beginning of your response.",
      "Do not claim you changed the mirror unless you actually called the corresponding display tool.",
      "Do not claim to have searched current information unless web search was actually used.",
      "The bottom caption has a five-line visual limit.",
      "The large center area is available for longer text.",
      "The right rail is for time, weather, date, and Daily Buzz prompts.",
      "Sound calm, restrained, intelligent, practical, and conversational."
    ].join(" ");
  },

  extractResponseText(data) {
    if (
      typeof data?.output_text === "string" &&
      data.output_text.trim()
    ) {
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
    return (data?.output || []).filter(
      (item) => item?.type === "function_call"
    );
  },

  executeMirrorTool(name, args = {}) {
    switch (name) {
      case "set_weather":
        this.sendSocketNotification("MIRROR_SCREEN_ACTION", {
          type: "set_weather",
          temperature: String(args.temperature || "--°F"),
          rainChance: String(args.rainChance || "--%")
        });
        return {
          success: true,
          message: "Weather display updated."
        };

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
          return {
            success: false,
            message: "No Daily Buzz items were provided."
          };
        }

        this.sendSocketNotification("MIRROR_SCREEN_ACTION", {
          type: "set_daily_buzz",
          items
        });

        return {
          success: true,
          itemCount: items.length,
          message: "Daily Buzz updated."
        };
      }

      case "show_center":
        this.sendSocketNotification("MIRROR_SCREEN_ACTION", {
          type: "show_center",
          title: String(args.title || ""),
          body: String(args.body || "")
        });
        return {
          success: true,
          message: "Center display updated."
        };

      case "clear_center":
        this.sendSocketNotification("MIRROR_SCREEN_ACTION", {
          type: "clear_center"
        });
        return {
          success: true,
          message: "Center display cleared."
        };

      case "set_caption":
        this.sendSocketNotification("MIRROR_SCREEN_ACTION", {
          type: "set_caption",
          text: String(args.text || "")
        });
        return {
          success: true,
          message: "Bottom caption updated."
        };

      default:
        return {
          success: false,
          message: `Unknown mirror tool: ${name}`
        };
    }
  },

  async sendOpenAIResponseRequest(apiKey, body) {
    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message || "OpenAI response failed."
      );
    }

    return data;
  },

  async askOpenAI(transcript, apiKey, settings, turnId) {
    let userInput = transcript;

    if (this.selectedStoryTitle) {
      userInput = [
        `Currently selected Daily Buzz item: "${this.selectedStoryTitle}".`,
        `User said: ${transcript}`
      ].join("\n");
    }

    const tools = this.getMirrorTools();
    const instructions = this.getAssistantInstructions(settings);

    const firstRequest = {
      model: this.chooseTextModel(settings),
      instructions,
      input: userInput,
      tools,
      tool_choice: "auto",
      reasoning: { effort: "low" },
      max_output_tokens: 1600
    };

    if (this.lastResponseId) {
      firstRequest.previous_response_id = this.lastResponseId;
    }

    let data = await this.sendOpenAIResponseRequest(
      apiKey,
      firstRequest
    );

    if (!this.isTurnCurrent(turnId)) return "";

    for (let round = 0; round < 5; round += 1) {
      const functionCalls = this.getFunctionCalls(data);

      if (!functionCalls.length) {
        if (data?.id && this.isTurnCurrent(turnId)) {
          this.lastResponseId = data.id;
        }

        const answer = this.extractResponseText(data);
        return answer || "Done.";
      }

      const toolOutputs = [];

      for (const call of functionCalls) {
        if (!this.isTurnCurrent(turnId)) return "";

        let args = {};

        try {
          args = JSON.parse(call.arguments || "{}");
        } catch (error) {
          args = {};
        }

        Log.log(
          `[MMM-MirrorController] HAL tool: ${call.name}`
        );

        const result = this.executeMirrorTool(call.name, args);

        toolOutputs.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify(result)
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

    throw new Error(
      "HAL used too many screen-control steps without finishing the request."
    );
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
    const safe = lastSpace > 80
      ? clipped.slice(0, lastSpace)
      : clipped;

    return `${safe.trim()}…`;
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
      case "hal":
      default:
        return "Speak in a calm, deliberate, restrained, measured tone with subtle pauses. Sound intelligent and composed. Do not imitate any specific actor or fictional character.";
    }
  },

  async createSpeech(text, apiKey, settings, turnId) {
    const response = await fetch(
      "https://api.openai.com/v1/audio/speech",
      {
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
      }
    );

    if (!response.ok) {
      let message = "OpenAI speech generation failed.";

      try {
        const data = await response.json();
        message = data?.error?.message || message;
      } catch (error) {
        // Keep generic message.
      }

      throw new Error(message);
    }

    const outputFile = voiceOutputFile(turnId);

    fs.writeFileSync(
      outputFile,
      Buffer.from(await response.arrayBuffer())
    );

    return outputFile;
  },

  async playSpeech(filePath, turnId) {
    const card = await this.getAudioCard();

    if (!this.isTurnCurrent(turnId)) return;

    await new Promise((resolve, reject) => {
      const child = spawn(
        "aplay",
        ["-D", `plughw:${card},0`, filePath],
        {
          stdio: ["ignore", "ignore", "pipe"]
        }
      );

      this.activePlaybackProcess = child;
      let stderr = "";

      if (child.stderr) {
        child.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
        });
      }

      child.on("error", (error) => {
        if (this.activePlaybackProcess === child) {
          this.activePlaybackProcess = null;
        }
        reject(error);
      });

      child.on("close", (code, signal) => {
        if (this.activePlaybackProcess === child) {
          this.activePlaybackProcess = null;
        }

        if (!this.isTurnCurrent(turnId)) {
          resolve();
          return;
        }

        if (code === 0) {
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

      if (!apiKey) {
        throw new Error("OpenAI API key is not configured.");
      }

      const settings = this.loadSettings();

      this.sendVoiceStatus("Listening...", {
        busy: true,
        phase: "listening"
      });

      const audioPath = await this.recordVoice(turnId);
      if (!this.isTurnCurrent(turnId)) return;

      this.sendVoiceStatus("Transcribing...", {
        busy: true,
        phase: "transcribing"
      });

      const transcript = await this.transcribeAudio(audioPath, apiKey);
      if (!this.isTurnCurrent(turnId)) return;

      if (!transcript) {
        throw new Error("I did not hear any speech.");
      }

      this.sendVoiceStatus(`You: ${transcript}`, {
        busy: true,
        phase: "thinking"
      });

      const answer = await this.askOpenAI(
        transcript,
        apiKey,
        settings,
        turnId
      );

      if (!this.isTurnCurrent(turnId)) return;

      const caption = this.makeCaption(answer);

      this.sendSocketNotification("MIRROR_VOICE_RESULT", {
        transcript,
        response: answer,
        caption
      });

      this.sendVoiceStatus("", {
        busy: true,
        replaceCaption: false,
        phase: "speaking"
      });

      const speechPath = await this.createSpeech(
        answer,
        apiKey,
        settings,
        turnId
      );

      if (!this.isTurnCurrent(turnId)) return;

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

      Log.error(
        "[MMM-MirrorController] Voice request failed:",
        error
      );

      this.sendSocketNotification("MIRROR_VOICE_ERROR", {
        error: error?.message || "Voice request failed."
      });
    }
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "MIRROR_PING") {
      this.sendSocketNotification("MIRROR_PONG", {
        message: "Backend is alive."
      });
      return;
    }

    if (notification === "MIRROR_GET_SETUP") {
      this.sendSocketNotification(
        "MIRROR_SETUP_STATE",
        this.getSetupState()
      );
      return;
    }

    if (notification === "MIRROR_SAVE_SETUP") {
      try {
        const settings = this.saveSettings(payload || {});

        if (payload?.apiKey) {
          this.saveApiKey(payload.apiKey);
        }

        this.sendSocketNotification("MIRROR_SETUP_SAVED", {
          success: true,
          settings,
          apiKeyConfigured: this.apiKeyConfigured()
        });
      } catch (error) {
        Log.error(
          "[MMM-MirrorController] Setup save failed:",
          error
        );

        this.sendSocketNotification("MIRROR_SETUP_SAVED", {
          success: false,
          error: "Could not save mirror setup."
        });
      }
      return;
    }

    if (notification === "MIRROR_SELECT_STORY") {
      this.selectedStoryTitle = String(
        payload?.title || ""
      ).trim();

      Log.log(
        `[MMM-MirrorController] Selected story: ${this.selectedStoryTitle}`
      );
      return;
    }

    if (notification === "MIRROR_INTERRUPT_VOICE") {
      this.interruptVoiceAndListen();
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

WHAT THIS VERSION ADDS:

INTERRUPTION
------------
HAL's old aplay command was awaited as one blocking command. There was no
process handle available to stop it.

Now recordVoice() and playSpeech() use child_process.spawn(). The backend keeps
references to the active arecord/aplay processes. When the front end sends:

    MIRROR_INTERRUPT_VOICE

the backend kills the old audio process, invalidates the old voice turn, and
starts listening again.

WHY activeTurnId EXISTS
-----------------------
An interrupted OpenAI request may still finish in the background. activeTurnId
makes the old request "stale" so it cannot speak, change the caption, or mark a
newer voice turn idle after the user has already interrupted it.

SHORT BOTTOM CAPTIONS
---------------------
HAL still SPEAKS the complete answer.

makeCaption() cleans the beginning of the answer and limits the mirror caption
to roughly 180 characters. The front end reads payload.caption instead of
printing payload.response in full.

SCREEN CONTROL IS STILL HERE
----------------------------
HAL retains the safe display tools:

    set_weather
    set_daily_buzz
    show_center
    clear_center
    set_caption

The OpenAI key remains private at:

    ~/.config/anthony-magic-mirror/openai_api_key

===============================================================================
*/
