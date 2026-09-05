Module.register("MMM-MirrorController", {
  defaults: {
    mirrorName: "HAL",
    presenceSleepDelayMs: 90000,

    weather: {
      temperature: "--°F",
      rainChance: "--%"
    },

    headlines: [
      {
        category: "system",
        title: "Daily Buzz is not loaded yet",
        detail: "Say: load my Daily Buzz."
      }
    ]
  },


  start() {
    Log.info("Starting MMM-MirrorController");

    /*
     * CONTENT CURRENTLY ON THE SCREEN
     */

    this.weatherState = {
      ...this.config.weather
    };

    this.headlinesState = [
      ...this.config.headlines
    ];

    this.selectedStory = null;

    this.centerContent = null;


    /*
     * VOICE / SETUP STATE
     */

    this.spokenText =
      "Ready. Press V to talk.";

    this.setupLoaded = false;

    this.setupComplete = false;

    this.setupState = null;

    this.setupMessage = "";

    this.voiceBusy = false;

    /* Presence sensor state. The mirror stays awake until the sensor says the room is empty. */
    this.personPresent = true;
    this.presenceSleeping = false;
    this.presenceSleepTimer = null;


    this.sendSocketNotification(
      "MIRROR_GET_SETUP"
    );


    /*
     * Keep the clock fresh.
     */

    this.clockTimer =
      setInterval(
        () => {
          if (this.setupComplete) {
            this.updateDom(0);
          }
        },
        15000
      );


    /*
     * V = TALK
     */

    this.keyHandler =
      (event) => {

        if (
          this.setupComplete &&
          !this.voiceBusy &&
          String(
            event?.key || ""
          ).toLowerCase() === "v"
        ) {

          this.startVoiceTurn();
        }
      };


    window.addEventListener(
      "keydown",
      this.keyHandler
    );
  },


  suspend() {

    if (this.keyHandler) {

      window.removeEventListener(
        "keydown",
        this.keyHandler
      );
    }


    if (this.clockTimer) {

      clearInterval(
        this.clockTimer
      );
    }

    if (this.presenceSleepTimer) {
      clearTimeout(this.presenceSleepTimer);
      this.presenceSleepTimer = null;
    }
  },


  getStyles() {

    return [
      "MMM-MirrorController.css"
    ];
  },


  /*
   * START LISTENING
   */

  startVoiceTurn() {

    if (this.voiceBusy) {
      return;
    }


    this.voiceBusy = true;

    this.spokenText =
      "Listening...";


    this.updateDom(150);


    this.sendSocketNotification(
      "MIRROR_START_VOICE"
    );
  },


  /*
   * PRESENCE SENSOR
   *
   * GPIO27 is watched by the backend. A person wakes the mirror immediately.
   * An empty room starts a 90-second sleep timer.
   */

  handlePresence(present) {

    this.personPresent = Boolean(present);

    if (this.presenceSleepTimer) {
      clearTimeout(this.presenceSleepTimer);
      this.presenceSleepTimer = null;
    }

    if (this.personPresent) {

      const wasSleeping = this.presenceSleeping;
      this.presenceSleeping = false;

      if (wasSleeping) {
        this.updateDom(0);
      }

      return;
    }

    this.schedulePresenceSleep(
      Number(this.config.presenceSleepDelayMs) || 90000
    );
  },


  schedulePresenceSleep(delayMs) {

    this.presenceSleepTimer = setTimeout(
      () => {

        this.presenceSleepTimer = null;

        if (this.personPresent) {
          return;
        }

        /*
         * Do not blank the screen in the middle of a voice turn.
         * Check again shortly after HAL becomes idle.
         */
        if (this.voiceBusy) {
          this.schedulePresenceSleep(10000);
          return;
        }

        this.presenceSleeping = true;
        this.updateDom(0);
      },

      delayMs
    );
  },


  /*
   * SCREEN CONTROL API
   *
   * node_helper.js will send safe commands here.
   */

  applyScreenAction(
    action = {}
  ) {

    switch (action.type) {


      /*
       * TOP-RIGHT WEATHER
       */

      case "set_weather":

        this.weatherState = {

          temperature:
            String(
              action.temperature ||
              "--°F"
            ),

          rainChance:
            String(
              action.rainChance ||
              "--%"
            )
        };

        break;


      /*
       * RIGHT-SIDE DAILY BUZZ
       */

      case "set_daily_buzz":

        if (
          Array.isArray(
            action.items
          ) &&
          action.items.length
        ) {

          this.headlinesState =
            action.items
              .map(
                (item) => ({

                  category:
                    String(
                      item?.category ||
                      "buzz"
                    ),

                  title:
                    String(
                      item?.title || ""
                    ).trim(),

                  detail:
                    String(
                      item?.detail || ""
                    ).trim()

                })
              )
              .filter(
                (item) =>
                  item.title
              );


          this.selectedStory =
            null;
        }

        break;


      /*
       * LARGE CENTER DISPLAY
       */

      case "show_center":

        this.selectedStory =
          null;


        this.centerContent = {

          title:
            String(
              action.title || ""
            ).trim(),

          body:
            String(
              action.body || ""
            ).trim()
        };

        break;


      /*
       * CLEAR CENTER
       */

      case "clear_center":

        this.selectedStory =
          null;

        this.centerContent =
          null;

        break;


      /*
       * BOTTOM FIVE-LINE CAPTION
       */

      case "set_caption":

        this.spokenText =
          String(
            action.text || ""
          ).trim();

        break;


      default:

        Log.warn(
          "[MMM-MirrorController] Unknown screen action:",
          action
        );

        return;
    }


    this.updateDom(150);
  },


  /*
   * MESSAGES FROM BACKEND
   */

  socketNotificationReceived(
    notification,
    payload
  ) {


    /*
     * SETUP INFORMATION
     */

    if (
      notification ===
      "MIRROR_SETUP_STATE"
    ) {

      this.setupLoaded =
        true;


      this.setupState =
        payload;


      this.setupComplete =
        Boolean(
          payload &&
          payload.setupComplete
        );


      if (
        payload
          ?.settings
          ?.mirrorName
      ) {

        this.config.mirrorName =
          payload.settings.mirrorName;
      }


      if (this.setupComplete) {

        this.spokenText =
          payload
            ?.apiKeyConfigured

            ? "Ready. Press V to talk."

            : "Ready. OpenAI API key is not configured.";
      }


      this.updateDom(300);

      return;
    }


    /*
     * SETUP SAVED
     */

    if (
      notification ===
      "MIRROR_SETUP_SAVED"
    ) {

      if (
        payload?.success
      ) {

        this.setupComplete =
          true;


        this.setupState =
          payload;


        if (
          payload
            ?.settings
            ?.mirrorName
        ) {

          this.config.mirrorName =
            payload.settings.mirrorName;
        }


        this.spokenText =
          payload.apiKeyConfigured

            ? `Setup complete. ${this.config.mirrorName} is ready. Press V to talk.`

            : `Setup complete. ${this.config.mirrorName} is ready, but the OpenAI API key is not configured.`;


        this.updateDom(500);


      } else {

        this.setupMessage =
          payload?.error ||
          "Setup could not be saved.";


        this.updateDom(300);
      }


      return;
    }


    /*
     * HAL WANTS TO CHANGE THE SCREEN
     */

    if (
      notification ===
      "MIRROR_SCREEN_ACTION"
    ) {

      this.applyScreenAction(
        payload
      );

      return;
    }


    /*
     * COMPLETE SCREEN STATE
     */

    if (
      notification ===
      "MIRROR_SCREEN_STATE"
    ) {

      if (payload?.weather) {

        this.weatherState = {

          ...this.weatherState,

          ...payload.weather
        };
      }


      if (
        Array.isArray(
          payload?.headlines
        )
      ) {

        this.headlinesState =
          payload.headlines;
      }


      if (payload?.center) {

        this.centerContent =
          payload.center;
      }


      this.updateDom(150);

      return;
    }


    /*
     * LISTENING / THINKING STATUS
     */

    if (
      notification ===
      "MIRROR_VOICE_STATUS"
    ) {

      if (
        payload?.message &&
        payload
          ?.replaceCaption !==
          false
      ) {

        this.spokenText =
          payload.message;
      }


      if (
        typeof payload?.busy ===
        "boolean"
      ) {

        this.voiceBusy =
          payload.busy;
      }


      this.updateDom(150);

      return;
    }


    /*
     * FINAL AI ANSWER
     */

    if (
      notification ===
      "MIRROR_VOICE_RESULT"
    ) {

      this.voiceBusy =
        false;


      this.spokenText =
        payload?.response ||
        "I received the request, but no answer came back.";


      this.updateDom(150);

      return;
    }


    /*
     * VOICE ERROR
     */

    if (
      notification ===
      "MIRROR_VOICE_ERROR"
    ) {

      this.voiceBusy =
        false;


      this.spokenText =
        payload?.error ||
        "Voice request failed.";


      this.updateDom(150);

      return;
    }


    /*
     * MM-WAVE PRESENCE SENSOR
     */

    if (
      notification ===
      "MIRROR_PRESENCE"
    ) {

      this.handlePresence(
        payload?.present
      );

      return;
    }


    /*
     * BACKEND TEST
     */

    if (
      notification ===
      "MIRROR_PONG"
    ) {

      Log.info(
        "[MMM-MirrorController]",

        payload?.message ||
        "Backend responded."
      );
    }
  },


  /*
   * WHICH SCREEN SHOULD SHOW?
   */

  getDom() {

    if (!this.setupLoaded) {

      return (
        this.buildLoadingScreen()
      );
    }


    if (!this.setupComplete) {

      return (
        this.buildSetupScreen()
      );
    }


    if (this.presenceSleeping) {

      return (
        this.buildPresenceSleepScreen()
      );
    }


    return (
      this.buildMirrorScreen()
    );
  },


  /*
   * PRESENCE SLEEP SCREEN
   */

  buildPresenceSleepScreen() {

    const wrapper =
      document.createElement(
        "div"
      );

    wrapper.className =
      "mirror-presence-sleep";

    return wrapper;
  },


  /*
   * LOADING SCREEN
   */

  buildLoadingScreen() {

    const wrapper =
      document.createElement(
        "div"
      );


    wrapper.className =
      "mirror-loading-screen";


    const text =
      document.createElement(
        "div"
      );


    text.className =
      "mirror-loading-text";


    text.textContent =
      "Starting mirror...";


    wrapper.appendChild(
      text
    );


    return wrapper;
  },


  /*
   * FIRST-BOOT SETUP
   */

  buildSetupScreen() {

    const wrapper =
      document.createElement(
        "div"
      );


    wrapper.className =
      "mirror-setup-screen";


    const panel =
      document.createElement(
        "div"
      );


    panel.className =
      "mirror-setup-panel";


    const title =
      document.createElement(
        "h1"
      );


    title.textContent =
      "Welcome";


    const intro =
      document.createElement(
        "p"
      );


    intro.className =
      "mirror-setup-intro";


    intro.textContent =
      "Let's set up your mirror.";


    panel.appendChild(
      title
    );


    panel.appendChild(
      intro
    );


    const saved =
      this.setupState
        ?.settings || {};


    /*
     * USER NAME
     */

    const userName =
      this.createSetupField(
        panel,

        "Your name",

        "text",

        saved.userName ||
        "Anthony"
      );


    /*
     * MIRROR NAME
     */

    const mirrorName =
      this.createSetupField(
        panel,

        "What do you want to call the mirror?",

        "text",

        saved.mirrorName ||
        "HAL"
      );


    /*
     * LOCATION
     */

    const location =
      this.createSetupField(
        panel,

        "Location",

        "text",

        saved.location ||
        "Clovis, New Mexico"
      );


    /*
     * VOICE STYLE
     */

    const voiceLabel =
      document.createElement(
        "label"
      );


    voiceLabel.textContent =
      "Voice style";


    const voice =
      document.createElement(
        "select"
      );


    [
      [
        "hal",
        "HAL-style — calm and deliberate"
      ],

      [
        "natural",
        "Natural"
      ],

      [
        "warm",
        "Warm"
      ],

      [
        "direct",
        "Direct"
      ],

      [
        "formal",
        "Formal"
      ]

    ].forEach(
      ([value, name]) => {

        const option =
          document.createElement(
            "option"
          );


        option.value =
          value;


        option.textContent =
          name;


        voice.appendChild(
          option
        );
      }
    );


    voice.value =
      saved.voice ||
      "hal";


    panel.appendChild(
      voiceLabel
    );


    panel.appendChild(
      voice
    );


    /*
     * AI MODEL
     */

    const modelLabel =
      document.createElement(
        "label"
      );


    modelLabel.textContent =
      "AI model";


    const model =
      document.createElement(
        "select"
      );


    const automatic =
      document.createElement(
        "option"
      );


    automatic.value =
      "auto";


    automatic.textContent =
      "Automatic — recommended";


    model.appendChild(
      automatic
    );


    model.value =
      saved.model ||
      "auto";


    panel.appendChild(
      modelLabel
    );


    panel.appendChild(
      model
    );


    /*
     * API KEY
     */

    const apiKey =
      this.createSetupField(
        panel,

        "OpenAI API key",

        "password",

        ""
      );


    apiKey.placeholder =
      this.setupState
        ?.apiKeyConfigured

        ? "Already configured — leave blank to keep it"

        : "Optional for now";


    const security =
      document.createElement(
        "div"
      );


    security.className =
      "mirror-setup-security";


    security.textContent =
      "Your API key is stored privately on this device and is not placed in the GitHub repository.";


    panel.appendChild(
      security
    );


    /*
     * SETUP MESSAGE
     */

    if (this.setupMessage) {

      const message =
        document.createElement(
          "div"
        );


      message.className =
        "mirror-setup-message";


      message.textContent =
        this.setupMessage;


      panel.appendChild(
        message
      );
    }


    /*
     * FINISH SETUP
     */

    const button =
      document.createElement(
        "button"
      );


    button.className =
      "mirror-setup-button";


    button.textContent =
      "Finish Setup";


    button.addEventListener(
      "click",

      () => {

        const cleanUserName =
          userName.value.trim();


        const cleanMirrorName =
          mirrorName.value.trim();


        if (!cleanUserName) {

          this.setupMessage =
            "Please enter your name.";


          this.updateDom(200);

          return;
        }


        if (!cleanMirrorName) {

          this.setupMessage =
            "Please give the mirror a name.";


          this.updateDom(200);

          return;
        }


        this.setupMessage =
          "Saving setup...";


        this.sendSocketNotification(
          "MIRROR_SAVE_SETUP",

          {

            userName:
              cleanUserName,

            mirrorName:
              cleanMirrorName,

            location:
              location.value.trim(),

            voice:
              voice.value,

            model:
              model.value,

            apiKey:
              apiKey.value.trim()
          }
        );


        this.updateDom(200);
      }
    );


    panel.appendChild(
      button
    );


    wrapper.appendChild(
      panel
    );


    return wrapper;
  },


  /*
   * SETUP FIELD HELPER
   */

  createSetupField(
    panel,
    labelText,
    inputType,
    defaultValue
  ) {

    const label =
      document.createElement(
        "label"
      );


    label.textContent =
      labelText;


    const input =
      document.createElement(
        "input"
      );


    input.type =
      inputType;


    input.value =
      defaultValue;


    panel.appendChild(
      label
    );


    panel.appendChild(
      input
    );


    return input;
  },


  /*
   * CENTER DISPLAY
   */

  buildCenterCard(
    mainDisplay
  ) {

    const content =
      this.centerContent ||

      (
        this.selectedStory

          ? {

              title:
                this.selectedStory
                  .title,

              body:
                this.selectedStory
                  .detail
            }

          : null
      );


    if (!content) {
      return;
    }


    const expandedCard =
      document.createElement(
        "article"
      );


    expandedCard.className =
      "mirror-expanded-card";


    const title =
      document.createElement(
        "h1"
      );


    title.textContent =
      content.title ||
      "";


    const body =
      document.createElement(
        "p"
      );


    body.textContent =
      content.body ||
      "";


    expandedCard.appendChild(
      title
    );


    expandedCard.appendChild(
      body
    );


    mainDisplay.appendChild(
      expandedCard
    );
  },


  /*
   * NORMAL MIRROR
   */

  buildMirrorScreen() {

    const wrapper =
      document.createElement(
        "div"
      );


    wrapper.className =
      "mirror-controller";


    /*
     * CENTER
     */

    const mainDisplay =
      document.createElement(
        "main"
      );


    mainDisplay.className =
      "mirror-main-display";


    this.buildCenterCard(
      mainDisplay
    );


    /*
     * RIGHT RAIL
     */

    const rightRail =
      document.createElement(
        "aside"
      );


    rightRail.className =
      "mirror-right-rail";


    const now =
      new Date();


    /*
     * TIME
     */

    const time =
      document.createElement(
        "div"
      );


    time.className =
      "mirror-time";


    time.textContent =
      new Intl.DateTimeFormat(
        "en-US",

        {
          hour: "numeric",

          minute:
            "2-digit",

          hour12:
            true
        }

      ).format(now);


    /*
     * WEATHER
     */

    const weather =
      document.createElement(
        "div"
      );


    weather.className =
      "mirror-weather";


    const temperature =
      document.createElement(
        "span"
      );


    temperature.textContent =
      this.weatherState
        .temperature;


    const rain =
      document.createElement(
        "span"
      );


    rain.className =
      "mirror-rain";


    rain.textContent =
      `Rain ${this.weatherState.rainChance}`;


    weather.appendChild(
      temperature
    );


    weather.appendChild(
      rain
    );


    /*
     * DATE
     */

    const date =
      document.createElement(
        "div"
      );


    date.className =
      "mirror-date";


    date.textContent =
      new Intl.DateTimeFormat(
        "en-US",

        {
          weekday:
            "long",

          month:
            "long",

          day:
            "numeric"
        }

      ).format(now);


    /*
     * DAILY BUZZ
     */

    const headlines =
      document.createElement(
        "div"
      );


    headlines.className =
      "mirror-headlines";


    this.headlinesState.forEach(
      (story) => {

        const headline =
          document.createElement(
            "button"
          );


        headline.className =
          "mirror-headline";


        headline.textContent =
          story.title;


        if (
          this.selectedStory
            ?.title ===
          story.title
        ) {

          headline.classList.add(
            "active"
          );
        }


        /*
         * Clicking a Daily Buzz item expands it.
         */

        headline.addEventListener(
          "click",

          () => {

            this.centerContent =
              null;


            this.selectedStory =
              story;


            /*
             * This is intentionally an invitation,
             * not an automatic long explanation.
             */

            this.spokenText =
              `Ask me about: ${story.title}`;


            /*
             * Tell the backend which story is selected.
             * This allows:
             *
             * "Tell me more about that."
             */

            this.sendSocketNotification(
              "MIRROR_SELECT_STORY",

              {
                title:
                  story.title
              }
            );


            this.updateDom(200);
          }
        );


        headlines.appendChild(
          headline
        );
      }
    );


    rightRail.appendChild(
      time
    );


    rightRail.appendChild(
      weather
    );


    rightRail.appendChild(
      date
    );


    rightRail.appendChild(
      headlines
    );


    /*
     * BOTTOM RESPONSE
     */

    const responseArea =
      document.createElement(
        "section"
      );


    responseArea.className =
      "mirror-response";


    responseArea.title =
      "Press V or click here to talk";


    responseArea.addEventListener(
      "click",

      () =>
        this.startVoiceTurn()
    );


    const voiceName =
      document.createElement(
        "div"
      );


    voiceName.className =
      "mirror-voice-name";


    voiceName.textContent =
      this.config.mirrorName;


    const caption =
      document.createElement(
        "div"
      );


    caption.className =
      "mirror-caption";


    caption.textContent =
      this.spokenText;


    responseArea.appendChild(
      voiceName
    );


    responseArea.appendChild(
      caption
    );


    /*
     * FINAL SCREEN
     */

    wrapper.appendChild(
      mainDisplay
    );


    wrapper.appendChild(
      rightRail
    );


    wrapper.appendChild(
      responseArea
    );


    return wrapper;
  }
});


/*
===============================================================================
NOTES TO A NEWBIE PROGRAMMER
===============================================================================

WHAT CHANGED?

The mirror now has SCREEN STATE.

Previously these things came directly from config:

    weather
    headlines

That meant they were basically permanent placeholders.

Now they can change while the mirror is running.


HAL CAN EVENTUALLY SEND THESE COMMANDS:

    set_weather

    set_daily_buzz

    show_center

    clear_center

    set_caption


EXAMPLE:

HAL can send:

    {
      type: "set_weather",
      temperature: "81°F",
      rainChance: "20%"
    }

and the top-right corner changes immediately.


DAILY BUZZ DESIGN:

The right-side Daily Buzz should NOT contain long summaries.

Those lines are supposed to make the user curious.

Examples:

    "Be still, and know that I am God."

    "New Mexico water ruling announced"

    "Researchers find unusual deep-sea signal"


The user can then say:

    "Tell me about the water ruling."

or:

    "What does that Scripture mean?"


CLICKING AN ITEM:

Clicking a Daily Buzz line opens its longer detail in the center.

It also tells node_helper.js which item was selected.

That means a voice question such as:

    "Tell me more about that."

can eventually refer to the selected story.


SECURITY:

HAL is NOT being given unrestricted computer control.

We are giving HAL control of the DISPLAY through a defined list of safe
commands.

That means it can become very powerful on the mirror without being able to
randomly execute Linux commands or rewrite files.

===============================================================================
*/
