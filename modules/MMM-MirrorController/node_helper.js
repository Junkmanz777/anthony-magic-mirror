const NodeHelper = require("node_helper");
const Log = require("logger");

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);


/*
 * PRIVATE FILES
 */

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

  /*
   * START
   */

  start() {

    Log.log(
      "[MMM-MirrorController] Backend starting..."
    );


    this.voiceBusy = false;

    /*
     * This gives HAL short-term conversational memory.
     *
     * It lasts until MagicMirror restarts.
     */

    this.lastResponseId = null;


    /*
     * If the user clicks a Daily Buzz headline,
     * remember which one.
     */

    this.selectedStoryTitle = "";


    this.ensurePrivateStorage();


    this.prepareAudio()
      .catch(
        (error) => {

          Log.warn(
            "[MMM-MirrorController] Audio preparation warning:",
            error.message
          );
        }
      );


    Log.log(
      "[MMM-MirrorController] Backend ready."
    );
  },


  /*
   * PRIVATE STORAGE
   */

  ensurePrivateStorage() {

    if (
      !fs.existsSync(
        DATA_DIR
      )
    ) {

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
   * SETTINGS
   */

  getDefaultSettings() {

    return {

      userName: "",

      mirrorName:
        "HAL",

      location:
        "Clovis, New Mexico",

      voice:
        "hal",

      model:
        "auto"
    };
  },


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


  saveSettings(payload = {}) {

    const settings = {

      userName:
        String(
          payload.userName ||
          ""
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
        encoding:
          "utf8",

        mode:
          0o600
      }
    );


    fs.chmodSync(
      SETTINGS_FILE,
      0o600
    );


    return settings;
  },


  /*
   * OPENAI API KEY
   */

  saveApiKey(apiKey) {

    if (
      typeof apiKey !==
        "string" ||

      apiKey.trim() ===
        ""
    ) {

      return false;
    }


    fs.writeFileSync(
      API_KEY_FILE,

      apiKey.trim(),

      {
        encoding:
          "utf8",

        mode:
          0o600
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
        this
          .loadApiKey()
          .length > 0
      );

    } catch (error) {

      return false;
    }
  },


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
   * AUDIO CARD
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
              encoding:
                "utf8"
            }
          );


        const match =
          `${stdout}\n${stderr}`
            .match(
              /card\s+(\d+):\s+wm8960soundcard/i
            );


        if (match) {

          return Number(
            match[1]
          );
        }


      } catch (error) {

        /*
         * Try the other ALSA command.
         */
      }
    }


    throw new Error(
      "WM8960 audio HAT was not found."
    );
  },


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
          encoding:
            "utf8"
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
   * SCREEN STATUS MESSAGE
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
   * MICROPHONE RECORDING
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
       * Fine if no old file exists.
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
        encoding:
          "utf8",

        timeout:
          12000
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
          type:
            "audio/wav"
        }
      ),

      "mirror-question.wav"
    );


    const response =
      await fetch(
        "https://api.openai.com/v1/audio/transcriptions",

        {

          method:
            "POST",

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
        data
          ?.error
          ?.message ||

        "OpenAI transcription failed."
      );
    }


    return String(
      data?.text ||
      ""
    ).trim();
  },


  /*
   * MODEL CHOICE
   */

  chooseTextModel(settings) {

    if (
      settings.model &&
      settings.model !==
        "auto"
    ) {

      return settings.model;
    }


    return "gpt-5-mini";
  },


  /*
   * OPENAI SCREEN TOOLS
   *
   * These are the ONLY display commands
   * HAL is allowed to issue.
   */

  getMirrorTools() {

    return [

      /*
       * BUILT-IN LIVE WEB SEARCH
       */

      {
        type:
          "web_search",

        search_context_size:
          "low",

        user_location: {

          type:
            "approximate",

          city:
            "Clovis",

          region:
            "New Mexico",

          country:
            "US",

          timezone:
            "America/Denver"
        }
      },


      /*
       * WEATHER
       */

      {
        type:
          "function",

        name:
          "set_weather",

        description:
          "Update the current temperature and rain chance shown in the top-right corner of the mirror. Use after finding current weather information.",

        strict:
          true,

        parameters: {

          type:
            "object",

          properties: {

            temperature: {

              type:
                "string",

              description:
                "Current temperature including unit, for example 82°F."
            },

            rainChance: {

              type:
                "string",

              description:
                "Current or near-term precipitation chance including percent sign, for example 20%."
            }
          },

          required: [
            "temperature",
            "rainChance"
          ],

          additionalProperties:
            false
        }
      },


      /*
       * DAILY BUZZ
       */

      {
        type:
          "function",

        name:
          "set_daily_buzz",

        description:
          "Replace the short Daily Buzz prompts shown in the right rail. These should be short curiosity-provoking prompts the user may want to ask about, not long summaries.",

        strict:
          true,

        parameters: {

          type:
            "object",

          properties: {

            items: {

              type:
                "array",

              minItems:
                3,

              maxItems:
                7,

              items: {

                type:
                  "object",

                properties: {

                  category: {

                    type:
                      "string",

                    description:
                      "A short category such as scripture, world, US, New Mexico, Clovis, faith, science, or interest."
                  },

                  title: {

                    type:
                      "string",

                    description:
                      "A very short line for the right rail, preferably under 10 words."
                  },

                  detail: {

                    type:
                      "string",

                    description:
                      "A compact explanation held behind the headline for when the user clicks it or asks about it."
                  }
                },

                required: [
                  "category",
                  "title",
                  "detail"
                ],

                additionalProperties:
                  false
              }
            }
          },

          required: [
            "items"
          ],

          additionalProperties:
            false
        }
      },


      /*
       * CENTER SCREEN
       */

      {
        type:
          "function",

        name:
          "show_center",

        description:
          "Show longer information in the large center portion of the mirror.",

        strict:
          true,

        parameters: {

          type:
            "object",

          properties: {

            title: {

              type:
                "string"
            },

            body: {

              type:
                "string"
            }
          },

          required: [
            "title",
            "body"
          ],

          additionalProperties:
            false
        }
      },


      /*
       * CLEAR CENTER
       */

      {
        type:
          "function",

        name:
          "clear_center",

        description:
          "Clear temporary information from the center of the mirror and return it to an open mirror area.",

        strict:
          true,

        parameters: {

          type:
            "object",

          properties: {},

          additionalProperties:
            false
        }
      },


      /*
       * BOTTOM CAPTION
       */

      {
        type:
          "function",

        name:
          "set_caption",

        description:
          "Change the short caption shown at the bottom of the mirror.",

        strict:
          true,

        parameters: {

          type:
            "object",

          properties: {

            text: {

              type:
                "string"
            }
          },

          required: [
            "text"
          ],

          additionalProperties:
            false
        }
      }
    ];
  },


  /*
   * HAL'S OPERATING INSTRUCTIONS
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

      `You are ${mirrorName}, an intelligent voice assistant controlling a smart mirror for ${userName}.`,

      `The user's saved location is ${location}.`,

      "Answer the user's actual question directly.",

      "You control the mirror through safe display tools.",

      "Use those tools whenever the user's request should visibly change the mirror.",


      /*
       * WEATHER BEHAVIOR
       */

      "For current weather, temperature, rain, or forecast questions, use web search.",

      "When you obtain the current temperature, also call set_weather so the top-right display stays useful.",


      /*
       * DAILY BUZZ BEHAVIOR
       */

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


      /*
       * CENTER SCREEN
       */

      "Use show_center when information is too long for the five-line bottom caption or when the user asks to display something.",

      "Use clear_center when the user asks to clear, close, hide, dismiss, or return to the mirror.",


      /*
       * GENERAL
       */

      "Keep ordinary spoken answers concise unless more detail is useful.",

      "Do not claim you changed the mirror unless you actually called the corresponding display tool.",

      "Do not claim to have searched current information unless web search was actually used.",

      "The bottom caption has a five-line visual limit.",

      "The large center area is available for longer text.",

      "The right rail is for time, weather, date, and Daily Buzz prompts.",

      "Sound calm, restrained, intelligent, practical, and conversational."

    ].join(" ");
  },


  /*
   * TEXT FROM A RESPONSES API RESULT
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
   * FUNCTION CALLS REQUESTED BY HAL
   */

  getFunctionCalls(data) {

    return (
      data?.output || []
    ).filter(
      (item) =>
        item?.type ===
        "function_call"
    );
  },


  /*
   * SAFE MIRROR COMMAND EXECUTION
   */

  executeMirrorTool(
    name,
    args = {}
  ) {

    switch (name) {


      /*
       * WEATHER
       */

      case "set_weather":

        this.sendSocketNotification(
          "MIRROR_SCREEN_ACTION",

          {

            type:
              "set_weather",

            temperature:
              String(
                args.temperature ||
                "--°F"
              ),

            rainChance:
              String(
                args.rainChance ||
                "--%"
              )
          }
        );


        return {

          success:
            true,

          message:
            "Weather display updated."
        };


      /*
       * DAILY BUZZ
       */

      case "set_daily_buzz": {

        const items =
          Array.isArray(
            args.items
          )

            ? args.items
                .slice(0, 7)
                .map(
                  (item) => ({

                    category:
                      String(
                        item
                          ?.category ||
                        "buzz"
                      ),

                    title:
                      String(
                        item
                          ?.title ||
                        ""
                      ).trim(),

                    detail:
                      String(
                        item
                          ?.detail ||
                        ""
                      ).trim()
                  })
                )
                .filter(
                  (item) =>
                    item.title
                )

            : [];


        if (!items.length) {

          return {

            success:
              false,

            message:
              "No Daily Buzz items were provided."
          };
        }


        this.sendSocketNotification(
          "MIRROR_SCREEN_ACTION",

          {

            type:
              "set_daily_buzz",

            items
          }
        );


        return {

          success:
            true,

          itemCount:
            items.length,

          message:
            "Daily Buzz updated."
        };
      }


      /*
       * CENTER
       */

      case "show_center":

        this.sendSocketNotification(
          "MIRROR_SCREEN_ACTION",

          {

            type:
              "show_center",

            title:
              String(
                args.title ||
                ""
              ),

            body:
              String(
                args.body ||
                ""
              )
          }
        );


        return {

          success:
            true,

          message:
            "Center display updated."
        };


      /*
       * CLEAR CENTER
       */

      case "clear_center":

        this.sendSocketNotification(
          "MIRROR_SCREEN_ACTION",

          {
            type:
              "clear_center"
          }
        );


        return {

          success:
            true,

          message:
            "Center display cleared."
        };


      /*
       * CAPTION
       */

      case "set_caption":

        this.sendSocketNotification(
          "MIRROR_SCREEN_ACTION",

          {

            type:
              "set_caption",

            text:
              String(
                args.text ||
                ""
              )
          }
        );


        return {

          success:
            true,

          message:
            "Bottom caption updated."
        };


      default:

        return {

          success:
            false,

          message:
            `Unknown mirror tool: ${name}`
        };
    }
  },


  /*
   * SEND ONE RESPONSES API REQUEST
   */

  async sendOpenAIResponseRequest(
    apiKey,
    body
  ) {

    const response =
      await fetch(
        "https://api.openai.com/v1/responses",

        {

          method:
            "POST",

          headers: {

            Authorization:
              `Bearer ${apiKey}`,

            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify(
              body
            )
        }
      );


    const data =
      await response.json();


    if (!response.ok) {

      throw new Error(
        data
          ?.error
          ?.message ||

        "OpenAI response failed."
      );
    }


    return data;
  },


  /*
   * ASK HAL
   *
   * This function now supports a TOOL LOOP.
   *
   * Example:
   *
   * User:
   *   "Load my Daily Buzz."
   *
   * HAL:
   *   1. searches web
   *   2. calls set_daily_buzz
   *   3. mirror changes
   *   4. HAL says "Daily Buzz loaded."
   */

  async askOpenAI(
    transcript,
    apiKey,
    settings
  ) {

    let userInput =
      transcript;


    /*
     * Give HAL context about a clicked headline.
     */

    if (
      this.selectedStoryTitle
    ) {

      userInput =
        [
          `Currently selected Daily Buzz item: "${this.selectedStoryTitle}".`,
          `User said: ${transcript}`
        ].join("\n");
    }


    const tools =
      this.getMirrorTools();


    const instructions =
      this.getAssistantInstructions(
        settings
      );


    /*
     * FIRST REQUEST
     */

    const firstRequest = {

      model:
        this.chooseTextModel(
          settings
        ),

      instructions,

      input:
        userInput,

      tools,

      tool_choice:
        "auto",

      reasoning: {

        effort:
          "low"
      },

      max_output_tokens:
        1600
    };


    /*
     * Continue normal conversation.
     */

    if (
      this.lastResponseId
    ) {

      firstRequest.previous_response_id =
        this.lastResponseId;
    }


    let data =
      await this
        .sendOpenAIResponseRequest(
          apiKey,
          firstRequest
        );


    /*
     * HAL may request more than one tool.
     *
     * We allow several rounds, but not forever.
     */

    for (
      let round = 0;
      round < 5;
      round += 1
    ) {

      const functionCalls =
        this.getFunctionCalls(
          data
        );


      /*
       * NO LOCAL FUNCTION CALLS:
       *
       * We have HAL's final response.
       */

      if (
        !functionCalls.length
      ) {

        if (data?.id) {

          this.lastResponseId =
            data.id;
        }


        const answer =
          this.extractResponseText(
            data
          );


        /*
         * A screen-only request might theoretically
         * produce no spoken text.
         */

        if (!answer) {

          return "Done.";
        }


        return answer;
      }


      /*
       * RUN EVERY SAFE LOCAL TOOL
       */

      const toolOutputs = [];


      for (
        const call
        of functionCalls
      ) {

        let args = {};


        try {

          args =
            JSON.parse(
              call.arguments ||
              "{}"
            );

        } catch (error) {

          args = {};
        }


        Log.log(
          `[MMM-MirrorController] HAL tool: ${call.name}`
        );


        const result =
          this.executeMirrorTool(
            call.name,
            args
          );


        toolOutputs.push(
          {

            type:
              "function_call_output",

            call_id:
              call.call_id,

            output:
              JSON.stringify(
                result
              )
          }
        );
      }


      /*
       * RETURN TOOL RESULTS TO OPENAI
       *
       * This gives HAL the opportunity to say:
       *
       * "Daily Buzz loaded."
       */

      const nextRequest = {

        model:
          this.chooseTextModel(
            settings
          ),

        instructions,

        previous_response_id:
          data.id,

        input:
          toolOutputs,

        tools,

        tool_choice:
          "auto",

        reasoning: {

          effort:
            "low"
        },

        max_output_tokens:
          1600
      };


      data =
        await this
          .sendOpenAIResponseRequest(
            apiKey,
            nextRequest
          );
    }


    throw new Error(
      "HAL used too many screen-control steps without finishing the request."
    );
  },


  /*
   * SPEAKING STYLE
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
          "Speak clearly, firmly, and efficiently."
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

          method:
            "POST",

          headers: {

            Authorization:
              `Bearer ${apiKey}`,

            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify(
              {

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
              }
            )
        }
      );


    if (!response.ok) {

      let message =
        "OpenAI speech generation failed.";


      try {

        const data =
          await response.json();


        message =
          data
            ?.error
            ?.message ||

          message;

      } catch (error) {

        /*
         * Keep generic message.
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
        encoding:
          "utf8",

        timeout:
          120000
      }
    );
  },


  /*
   * COMPLETE VOICE TURN
   */

  async handleVoiceRequest() {

    if (
      this.voiceBusy
    ) {

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


      /*
       * LISTEN
       */

      this.sendVoiceStatus(
        "Listening...",

        {
          busy:
            true
        }
      );


      const audioPath =
        await this.recordVoice();


      /*
       * TRANSCRIBE
       */

      this.sendVoiceStatus(
        "Transcribing...",

        {
          busy:
            true
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


      /*
       * SHOW WHAT HAL HEARD
       */

      this.sendVoiceStatus(
        `You: ${transcript}`,

        {
          busy:
            true
        }
      );


      /*
       * THINK / SEARCH / CONTROL SCREEN
       */

      const answer =
        await this.askOpenAI(
          transcript,
          apiKey,
          settings
        );


      /*
       * SHOW FINAL ANSWER
       */

      this.sendSocketNotification(
        "MIRROR_VOICE_RESULT",

        {

          transcript,

          response:
            answer
        }
      );


      /*
       * KEEP FINAL CAPTION WHILE SPEAKING
       */

      this.sendVoiceStatus(
        "",

        {

          busy:
            true,

          replaceCaption:
            false
        }
      );


      /*
       * CREATE SPOKEN ANSWER
       */

      const speechPath =
        await this.createSpeech(
          answer,
          apiKey,
          settings
        );


      /*
       * SPEAK
       */

      await this.playSpeech(
        speechPath
      );


      this.voiceBusy =
        false;


      this.sendVoiceStatus(
        "",

        {

          busy:
            false,

          replaceCaption:
            false
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
   * FRONT-END MESSAGES
   */

  socketNotificationReceived(
    notification,
    payload
  ) {


    /*
     * BACKEND TEST
     */

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


    /*
     * GET SETUP
     */

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


    /*
     * SAVE SETUP
     */

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


    /*
     * USER CLICKED A DAILY BUZZ ITEM
     */

    if (
      notification ===
      "MIRROR_SELECT_STORY"
    ) {

      this.selectedStoryTitle =
        String(
          payload?.title ||
          ""
        ).trim();


      Log.log(
        `[MMM-MirrorController] Selected story: ${this.selectedStoryTitle}`
      );


      return;
    }


    /*
     * START TALKING TO HAL
     */

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

WHAT CHANGED?

HAL can now DO more than answer questions.

It has a small collection of safe MIRROR TOOLS.


HAL'S SCREEN TOOLS:

    set_weather

Changes:

    temperature
    rain chance


    set_daily_buzz

Changes the short prompts on the right side.


    show_center

Displays longer information in the large center area.


    clear_center

Clears the center display.


    set_caption

Changes the bottom caption.


WHAT ABOUT THE WEB?

OpenAI also receives:

    web_search

That is different from our screen tools.

OpenAI performs the web search itself.

Our Raspberry Pi performs the screen-control tools.


EXAMPLE:

USER:

    "HAL, load my Daily Buzz."


HAL CAN NOW:

    1. Search current news.

    2. Decide which stories are useful.

    3. Add one Scripture prompt.

    4. Call set_daily_buzz.

    5. The right rail changes.

    6. Say:
       "Your Daily Buzz is loaded."


WHY ARE THE DAILY BUZZ TITLES SHORT?

The right side is not supposed to replace reading or conversation.

It is supposed to create curiosity.

For example:

    "Be still, and know that I am God."

    "New Mexico water ruling announced"

    "AI researchers report new breakthrough"

The idea is that the user sees something interesting and says:

    "Tell me about the water ruling."

or:

    "What does that verse mean?"


WHAT HAPPENS WHEN A HEADLINE IS CLICKED?

The front end sends:

    MIRROR_SELECT_STORY

The backend remembers the selected title.

So the user can say:

    "Tell me more about that."


WHY NOT GIVE HAL SHELL ACCESS?

HAL does NOT get permission to execute arbitrary Linux commands.

It cannot decide to:

    delete files
    install programs
    rewrite code
    shut down Linux

Instead, HAL receives a carefully defined set of mirror controls.

That gives HAL broad control over the EXPERIENCE without giving the model
dangerous unrestricted control over the Raspberry Pi.


WHAT IS THE TOOL LOOP?

Sometimes HAL has to:

    search
    change the screen
    receive confirmation
    answer the user

That requires several messages between our program and OpenAI.

The loop inside:

    askOpenAI()

handles those steps automatically.


CONVERSATION MEMORY:

HAL still remembers the previous OpenAI response through:

    this.lastResponseId

So conversations such as:

    "What's the temperature?"

    "What about tomorrow?"

can retain context.


NEXT STEPS AFTER THIS WORKS:

1. Say:
       "HAL, load my Daily Buzz."

2. Verify the right-side headlines change.

3. Ask about one of the headlines.

4. Say:
       "Show that in the center."

5. Say:
       "Clear the center."

6. Make weather and Daily Buzz refresh automatically at startup.

7. Add hands-free wake-word listening.

===============================================================================
*/
