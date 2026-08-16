const NodeHelper = require("node_helper");
const Log = require("logger");

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const DATA_DIR = path.join(
  os.homedir(),
  ".config",
  "anthony-magic-mirror"
);

const SETTINGS_FILE = path.join(
  DATA_DIR,
  "settings.json"
);

const API_KEY_FILE = path.join(
  DATA_DIR,
  "openai_api_key"
);

const VOICE_INPUT_FILE = path.join(
  os.tmpdir(),
  "anthony-mirror-input.wav"
);

const VOICE_OUTPUT_FILE = path.join(
  os.tmpdir(),
  "anthony-mirror-output.wav"
);


module.exports = NodeHelper.create({

  start() {
    Log.log(
      "[MMM-MirrorController] Backend starting..."
    );

    this.voiceBusy = false;

    /*
     * Remembers the previous OpenAI answer so follow-up
     * questions can understand the conversation.
     */
    this.lastResponseId = null;

    this.ensurePrivateStorage();

    this.prepareAudio().catch((error) => {
      Log.warn(
        "[MMM-MirrorController] Audio preparation warning:",
        error.message
      );
    });

    Log.log(
      "[MMM-MirrorController] Backend ready."
    );
  },


  /*
   * PRIVATE STORAGE
   */

  ensurePrivateStorage() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(
        DATA_DIR,
        {
          recursive: true,
          mode: 0o700
        }
      );
    }

    try {
      fs.chmodSync(
        DATA_DIR,
        0o700
      );
    } catch (error) {
      Log.warn(
        "[MMM-MirrorController] Could not change storage permissions."
      );
    }
  },


  /*
   * DEFAULT SETTINGS
   */

  getDefaultSettings() {
    return {
      userName: "",
      mirrorName: "HAL",
      location: "Clovis, New Mexico",
      voice: "hal",
      model: "auto"
    };
  },


  /*
   * LOAD SETTINGS
   */

  loadSettings() {
    const defaults =
      this.getDefaultSettings();

    if (
      !fs.existsSync(
        SETTINGS_FILE
      )
    ) {
      return defaults;
    }

    try {
      const stored =
        JSON.parse(
          fs.readFileSync(
            SETTINGS_FILE,
            "utf8"
          )
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


  /*
   * SAVE SETTINGS
   */

  saveSettings(payload = {}) {
    const settings = {

      userName:
        String(
          payload.userName || ""
        ).trim(),

      mirrorName:
        String(
          payload.mirrorName ||
          "HAL"
        ).trim(),

      location:
        String(
          payload.location ||
          "Clovis, New Mexico"
        ).trim(),

      voice:
        String(
          payload.voice ||
          "hal"
        ).trim(),

      model:
        String(
          payload.model ||
          "auto"
        ).trim()
    };

    fs.writeFileSync(
      SETTINGS_FILE,
      JSON.stringify(
        settings,
        null,
        2
      ),
      {
        encoding: "utf8",
        mode: 0o600
      }
    );

    fs.chmodSync(
      SETTINGS_FILE,
      0o600
    );

    return settings;
  },


  /*
   * API KEY
   */

  saveApiKey(apiKey) {
    if (
      typeof apiKey !== "string" ||
      apiKey.trim() === ""
    ) {
      return false;
    }

    fs.writeFileSync(
      API_KEY_FILE,
      apiKey.trim(),
      {
        encoding: "utf8",
        mode: 0o600
      }
    );

    fs.chmodSync(
      API_KEY_FILE,
      0o600
    );

    return true;
  },


  loadApiKey() {
    if (
      !fs.existsSync(
        API_KEY_FILE
      )
    ) {
      return "";
    }

    return fs
      .readFileSync(
        API_KEY_FILE,
        "utf8"
      )
      .trim();
  },


  apiKeyConfigured() {
    try {
      return (
        this.loadApiKey()
          .length > 0
      );
    } catch (error) {
      return false;
    }
  },


  /*
   * SETUP STATE
   */

  getSetupState() {
    const settings =
      this.loadSettings();

    return {

      settings,

      apiKeyConfigured:
        this.apiKeyConfigured(),

      setupComplete:
        Boolean(
          settings.userName &&
          settings.mirrorName
        )
    };
  },


  /*
   * FIND WM8960 AUDIO CARD
   */

  async findWm8960Card() {

    const attempts = [
      [
        "arecord",
        ["-l"]
      ],
      [
        "aplay",
        ["-l"]
      ]
    ];

    for (
      const [command, args]
      of attempts
    ) {

      try {

        const {
          stdout = "",
          stderr = ""
        } =
          await execFileAsync(
            command,
            args,
            {
              encoding: "utf8"
            }
          );

        const match =
          `${stdout}\n${stderr}`.match(
            /card\s+(\d+):\s+wm8960soundcard/i
          );

        if (match) {
          return Number(
            match[1]
          );
        }

      } catch (error) {
        /*
         * Try next ALSA command.
         */
      }
    }

    throw new Error(
      "WM8960 audio HAT was not found."
    );
  },


  /*
   * SET ONE MIXER CONTROL
   */

  async setMixer(
    card,
    controlName,
    value
  ) {

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
        {
          encoding: "utf8"
        }
      );

      return true;

    } catch (error) {

      Log.warn(
        `[MMM-MirrorController] Mixer control skipped: ${controlName}`
      );

      return false;
    }
  },


  /*
   * PREPARE AUDIO
   */

  async prepareAudio() {

    const card =
      await this.findWm8960Card();

    this.audioCard =
      card;

    const controls = [

      [
        "Left Output Mixer PCM Playback Switch",
        "on"
      ],

      [
        "Right Output Mixer PCM Playback Switch",
        "on"
      ],

      [
        "Playback Volume",
        "255,255"
      ],

      [
        "Speaker Playback Volume",
        "109,109"
      ],

      [
        "Speaker DC Volume",
        "4"
      ],

      [
        "Speaker AC Volume",
        "4"
      ],

      [
        "Capture Switch",
        "on,on"
      ],

      [
        "Capture Volume",
        "55,55"
      ],

      [
        "ADC PCM Capture Volume",
        "220,220"
      ],

      [
        "Left Boost Mixer LINPUT1 Switch",
        "on"
      ],

      [
        "Right Boost Mixer RINPUT1 Switch",
        "on"
      ],

      [
        "Left Input Mixer Boost Switch",
        "on"
      ],

      [
        "Right Input Mixer Boost Switch",
        "on"
      ]
    ];

    for (
      const [name, value]
      of controls
    ) {

      await this.setMixer(
        card,
        name,
        value
      );
    }

    Log.log(
      `[MMM-MirrorController] WM8960 ready as ALSA card ${card}.`
    );

    return card;
  },


  async getAudioCard() {

    if (
      Number.isInteger(
        this.audioCard
      )
    ) {
      return this.audioCard;
    }

    return this.prepareAudio();
  },


  /*
   * SEND STATUS TO SCREEN
   */

  sendVoiceStatus(
    message,
    options = {}
  ) {

    this.sendSocketNotification(
      "MIRROR_VOICE_STATUS",
      {

        message,

        busy:
          options.busy ??
          this.voiceBusy,

        replaceCaption:
          options.replaceCaption ??
          true
      }
    );
  },


  /*
   * RECORD MICROPHONE
   */

  async recordVoice() {

    const card =
      await this.getAudioCard();

    try {
      fs.rmSync(
        VOICE_INPUT_FILE,
        {
          force: true
        }
      );
    } catch (error) {
      /*
       * Fine if old file doesn't exist.
       */
    }

    await execFileAsync(
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

        VOICE_INPUT_FILE
      ],
      {
        encoding: "utf8",
        timeout: 12000
      }
    );

    if (
      !fs.existsSync(
        VOICE_INPUT_FILE
      )
    ) {

      throw new Error(
        "The microphone recording was not created."
      );
    }

    return VOICE_INPUT_FILE;
  },


  /*
   * SPEECH TO TEXT
   */

  async transcribeAudio(
    filePath,
    apiKey
  ) {

    const audio =
      fs.readFileSync(
        filePath
      );

    const form =
      new FormData();

    form.append(
      "model",
      "gpt-4o-mini-transcribe"
    );

    form.append(
      "language",
      "en"
    );

    form.append(
      "file",

      new Blob(
        [audio],
        {
          type: "audio/wav"
        }
      ),

      "mirror-question.wav"
    );

    const response =
      await fetch(
        "https://api.openai.com/v1/audio/transcriptions",
        {
          method: "POST",

          headers: {
            Authorization:
              `Bearer ${apiKey}`
          },

          body:
            form
        }
      );

    const data =
      await response.json();

    if (!response.ok) {

      throw new Error(
        data?.error?.message ||
        "OpenAI transcription failed."
      );
    }

    return String(
      data?.text || ""
    ).trim();
  },


  /*
   * PICK AI MODEL
   */

  chooseTextModel(settings) {

    if (
      settings.model &&
      settings.model !== "auto"
    ) {

      return settings.model;
    }

    return "gpt-5-mini";
  },


  /*
   * HAL'S PERSONALITY / RULES
   */

  getAssistantInstructions(
    settings
  ) {

    const userName =
      settings.userName ||
      "the user";

    const mirrorName =
      settings.mirrorName ||
      "HAL";

    const location =
      settings.location ||
      "Clovis, New Mexico";

    return [

      `You are ${mirrorName}, a voice assistant running on a smart mirror for ${userName}.`,

      `The user's location is ${location}.`,

      "Answer the user's actual question directly.",

      "When the question depends on current information such as weather, temperature, news, prices, schedules, or something happening today, use web search before answering.",

      "For weather questions, assume the saved user location unless the user names another place.",

      "Keep spoken answers compact unless more detail is necessary.",

      "Do not pretend you performed actions or searches that you did not perform.",

      "If you do not know something, say so.",

      "The display has limited space, so favor clear concise sentences.",

      "For ordinary conversation, sound calm, restrained, intelligent, and practical."

    ].join(" ");
  },


  /*
   * GET TEXT FROM OPENAI RESPONSE
   */

  extractResponseText(data) {

    if (
      typeof data?.output_text ===
        "string" &&
      data.output_text.trim()
    ) {

      return data.output_text.trim();
    }

    const pieces = [];

    for (
      const item
      of data?.output || []
    ) {

      for (
        const content
        of item?.content || []
      ) {

        if (
          content?.type ===
            "output_text" &&
          content?.text
        ) {

          pieces.push(
            content.text
          );
        }
      }
    }

    return pieces
      .join("\n")
      .trim();
  },


  /*
   * ASK OPENAI
   */

  async askOpenAI(
    transcript,
    apiKey,
    settings
  ) {

    const requestBody = {

      model:
        this.chooseTextModel(
          settings
        ),

      instructions:
        this.getAssistantInstructions(
          settings
        ),

      input:
        transcript,


      /*
       * THIS IS IMPORTANT.
       *
       * HAL can now search the live web for
       * current information.
       */

      tools: [
        {
          type: "web_search",
          search_context_size:
            "low"
        }
      ],


      /*
       * GPT-5 Mini was previously allowed only
       * 300 output tokens with normal reasoning.
       *
       * That could use the available token budget
       * before any visible answer appeared.
       */

      reasoning: {
        effort: "low"
      },


      /*
       * Give the model enough room for reasoning
       * AND visible text.
       */

      max_output_tokens:
        1200
    };


    /*
     * CONVERSATION MEMORY
     *
     * If there was a previous answer, connect
     * this request to it.
     */

    if (this.lastResponseId) {

      requestBody.previous_response_id =
        this.lastResponseId;
    }


    const response =
      await fetch(
        "https://api.openai.com/v1/responses",
        {
          method: "POST",

          headers: {

            Authorization:
              `Bearer ${apiKey}`,

            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify(
              requestBody
            )
        }
      );


    const data =
      await response.json();


    if (!response.ok) {

      throw new Error(
        data?.error?.message ||
        "OpenAI response failed."
      );
    }


    /*
     * Remember this response for next time.
     */

    if (data?.id) {

      this.lastResponseId =
        data.id;
    }


    const answer =
      this.extractResponseText(
        data
      );


    if (!answer) {

      if (
        data
          ?.incomplete_details
          ?.reason ===
        "max_output_tokens"
      ) {

        throw new Error(
          "OpenAI ran out of response space before producing an answer."
        );
      }


      throw new Error(
        "OpenAI returned an empty answer."
      );
    }


    return answer;
  },


  /*
   * VOICE PERSONALITY
   */

  getVoiceInstructions(
    settings
  ) {

    switch (
      settings.voice
    ) {

      case "warm":

        return (
          "Speak warmly and naturally, with an easy conversational pace."
        );


      case "direct":

        return (
          "Speak clearly, firmly, and efficiently. Avoid unnecessary dramatic emphasis."
        );


      case "formal":

        return (
          "Speak in a composed, formal, precise manner."
        );


      case "natural":

        return (
          "Speak naturally and conversationally."
        );


      case "hal":

      default:

        return (
          "Speak in a calm, deliberate, restrained, measured tone with subtle pauses. Sound intelligent and composed. Do not imitate any specific actor or fictional character."
        );
    }
  },


  /*
   * TEXT TO SPEECH
   */

  async createSpeech(
    text,
    apiKey,
    settings
  ) {

    const response =
      await fetch(
        "https://api.openai.com/v1/audio/speech",
        {
          method: "POST",

          headers: {

            Authorization:
              `Bearer ${apiKey}`,

            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({

              model:
                "gpt-4o-mini-tts",

              voice:
                "onyx",

              input:
                text.slice(
                  0,
                  3500
                ),

              instructions:
                this.getVoiceInstructions(
                  settings
                ),

              response_format:
                "wav",

              speed:
                0.95
            })
        }
      );


    if (!response.ok) {

      let message =
        "OpenAI speech generation failed.";

      try {

        const data =
          await response.json();

        message =
          data?.error?.message ||
          message;

      } catch (error) {
        /*
         * Keep generic error.
         */
      }

      throw new Error(
        message
      );
    }


    fs.writeFileSync(
      VOICE_OUTPUT_FILE,

      Buffer.from(
        await response.arrayBuffer()
      )
    );


    return VOICE_OUTPUT_FILE;
  },


  /*
   * PLAY SPEECH
   */

  async playSpeech(
    filePath
  ) {

    const card =
      await this.getAudioCard();


    await execFileAsync(
      "aplay",
      [
        "-D",
        `plughw:${card},0`,

        filePath
      ],
      {
        encoding: "utf8",
        timeout: 120000
      }
    );
  },


  /*
   * COMPLETE VOICE REQUEST
   */

  async handleVoiceRequest() {

    if (this.voiceBusy) {
      return;
    }


    this.voiceBusy =
      true;


    try {

      const apiKey =
        this.loadApiKey();


      if (!apiKey) {

        throw new Error(
          "OpenAI API key is not configured."
        );
      }


      const settings =
        this.loadSettings();


      this.sendVoiceStatus(
        "Listening...",
        {
          busy: true
        }
      );


      const audioPath =
        await this.recordVoice();


      this.sendVoiceStatus(
        "Transcribing...",
        {
          busy: true
        }
      );


      const transcript =
        await this.transcribeAudio(
          audioPath,
          apiKey
        );


      if (!transcript) {

        throw new Error(
          "I did not hear any speech."
        );
      }


      this.sendVoiceStatus(
        `You: ${transcript}`,
        {
          busy: true
        }
      );


      const answer =
        await this.askOpenAI(
          transcript,
          apiKey,
          settings
        );


      this.sendSocketNotification(
        "MIRROR_VOICE_RESULT",
        {

          transcript,

          response:
            answer
        }
      );


      this.sendVoiceStatus(
        "",
        {
          busy: true,
          replaceCaption: false
        }
      );


      const speechPath =
        await this.createSpeech(
          answer,
          apiKey,
          settings
        );


      await this.playSpeech(
        speechPath
      );


      this.voiceBusy =
        false;


      this.sendVoiceStatus(
        "",
        {
          busy: false,
          replaceCaption: false
        }
      );


    } catch (error) {

      this.voiceBusy =
        false;


      Log.error(
        "[MMM-MirrorController] Voice request failed:",
        error
      );


      this.sendSocketNotification(
        "MIRROR_VOICE_ERROR",
        {

          error:
            error?.message ||
            "Voice request failed."
        }
      );
    }
  },


  /*
   * RECEIVE FRONT-END COMMANDS
   */

  socketNotificationReceived(
    notification,
    payload
  ) {


    if (
      notification ===
      "MIRROR_PING"
    ) {

      this.sendSocketNotification(
        "MIRROR_PONG",
        {
          message:
            "Backend is alive."
        }
      );

      return;
    }


    if (
      notification ===
      "MIRROR_GET_SETUP"
    ) {

      this.sendSocketNotification(
        "MIRROR_SETUP_STATE",
        this.getSetupState()
      );

      return;
    }


    if (
      notification ===
      "MIRROR_SAVE_SETUP"
    ) {

      try {

        const settings =
          this.saveSettings(
            payload || {}
          );


        if (
          payload?.apiKey
        ) {

          this.saveApiKey(
            payload.apiKey
          );
        }


        this.sendSocketNotification(
          "MIRROR_SETUP_SAVED",
          {

            success:
              true,

            settings,

            apiKeyConfigured:
              this.apiKeyConfigured()
          }
        );


      } catch (error) {

        Log.error(
          "[MMM-MirrorController] Setup save failed:",
          error
        );


        this.sendSocketNotification(
          "MIRROR_SETUP_SAVED",
          {

            success:
              false,

            error:
              "Could not save mirror setup."
          }
        );
      }


      return;
    }


    if (
      notification ===
      "MIRROR_START_VOICE"
    ) {

      this.handleVoiceRequest();
    }
  }
});


/*
===============================================================================
NOTES TO A NEWBIE PROGRAMMER
===============================================================================

WHAT THIS FILE DOES:

This is the BACK END of the smart mirror.

The visible MagicMirror module talks to this file whenever HAL needs to:

- listen through the microphones
- call OpenAI
- search for current information
- remember a conversation
- create spoken audio
- play the answer through the speakers


THE VOICE PIPELINE:

WM8960 microphone
       |
       v
    arecord
       |
       v
speech transcription
       |
       v
   GPT-5 Mini
       |
       v
 OpenAI speech
       |
       v
     aplay
       |
       v
WM8960 speakers


WHAT CHANGED TO FIX THE EMPTY ANSWERS?

The old version used:

    max_output_tokens: 300

GPT-5 models can use part of that token allowance
for reasoning.

If the allowance is too small, there may be no
visible answer left.

The new version uses:

    reasoning: {
      effort: "low"
    }

and:

    max_output_tokens: 1200


WHAT IS WEB SEARCH?

HAL now has:

    tools: [
      {
        type: "web_search"
      }
    ]

That means questions such as:

    "What is the temperature?"

    "What's happening in the news?"

    "Did it rain today?"

can use current information instead of relying only
on the AI model's built-in knowledge.


WHAT IS previous_response_id?

After OpenAI answers, the response has an ID.

We save it in:

    this.lastResponseId

The next question sends that ID back.

That allows:

    USER:
    What's the temperature?

    HAL:
    It's 84 degrees...

    USER:
    What about tomorrow?

HAL can understand what "tomorrow" is referring to.


HOW LONG DOES THAT MEMORY LAST?

For now, until MagicMirror restarts.

Later we can make longer-term memory if we want.


WHERE IS THE OPENAI API KEY?

Only on the Raspberry Pi:

    ~/.config/anthony-magic-mirror/openai_api_key

NEVER paste that key into GitHub.


HOW LONG DOES HAL LISTEN?

Currently:

    8 seconds

Later we can add voice activity detection so HAL
naturally stops recording when you stop speaking.


NEXT STEPS:

1. Test "What's the temperature?"
2. Test a normal knowledge question.
3. Test a follow-up question.
4. Add hands-free wake word.
5. Put real weather in the top-right display.
6. Build the Daily Buzz.

===============================================================================
*/
