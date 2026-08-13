Module.register("MMM-MirrorController", {
  defaults: {
    mirrorName: "HAL",

    weather: {
      temperature: "--°F",
      rainChance: "--%"
    },

    headlines: [
      {
        title: "Daily Buzz is not loaded yet",
        detail:
          "Later, this area will contain today's real Daily Buzz stories."
      }
    ]
  },


  /*
   * START
   *
   * Runs when MagicMirror loads this module.
   */

  start() {
    Log.info("Starting MMM-MirrorController");

    this.selectedStory = null;

    this.spokenText = "Ready.";

    /*
     * Until the backend answers us,
     * we don't know whether setup has been completed.
     */

    this.setupLoaded = false;

    this.setupComplete = false;

    this.setupState = null;

    this.setupMessage = "";


    /*
     * Ask node_helper.js for saved setup information.
     */

    this.sendSocketNotification(
      "MIRROR_GET_SETUP"
    );


    /*
     * Refresh the display every 15 seconds.
     *
     * This keeps the clock current.
     */

    this.clockTimer = setInterval(() => {
      this.updateDom(0);
    }, 15000);
  },


  getStyles() {
    return [
      "MMM-MirrorController.css"
    ];
  },


  /*
   * RECEIVE BACKEND MESSAGES
   */

  socketNotificationReceived(
    notification,
    payload
  ) {

    /*
     * Backend answered our setup question.
     */

    if (
      notification ===
      "MIRROR_SETUP_STATE"
    ) {

      this.setupLoaded = true;

      this.setupState = payload;

      this.setupComplete =
        Boolean(
          payload &&
          payload.setupComplete
        );


      /*
       * Use the saved mirror name.
       */

      if (
        payload &&
        payload.settings &&
        payload.settings.mirrorName
      ) {
        this.config.mirrorName =
          payload.settings.mirrorName;
      }


      this.updateDom(300);

      return;
    }


    /*
     * Backend finished saving setup.
     */

    if (
      notification ===
      "MIRROR_SETUP_SAVED"
    ) {

      if (
        payload &&
        payload.success
      ) {

        this.setupComplete = true;

        this.setupState = payload;

        if (
          payload.settings &&
          payload.settings.mirrorName
        ) {
          this.config.mirrorName =
            payload.settings.mirrorName;
        }

        this.spokenText =
          `Setup complete. ${this.config.mirrorName} is ready.`;

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
     * Simple backend communication test.
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
   * MAIN DISPLAY DECISION
   */

  getDom() {

    /*
     * Waiting for backend.
     */

    if (!this.setupLoaded) {
      return this.buildLoadingScreen();
    }


    /*
     * First boot.
     */

    if (!this.setupComplete) {
      return this.buildSetupScreen();
    }


    /*
     * Normal mirror.
     */

    return this.buildMirrorScreen();
  },


  /*
   * LOADING SCREEN
   */

  buildLoadingScreen() {

    const wrapper =
      document.createElement("div");

    wrapper.className =
      "mirror-loading-screen";


    const text =
      document.createElement("div");

    text.className =
      "mirror-loading-text";

    text.textContent =
      "Starting mirror...";


    wrapper.appendChild(text);

    return wrapper;
  },


  /*
   * FIRST-BOOT SETUP SCREEN
   */

  buildSetupScreen() {

    const wrapper =
      document.createElement("div");

    wrapper.className =
      "mirror-setup-screen";


    const panel =
      document.createElement("div");

    panel.className =
      "mirror-setup-panel";


    /*
     * TITLE
     */

    const title =
      document.createElement("h1");

    title.textContent =
      "Welcome";


    const intro =
      document.createElement("p");

    intro.className =
      "mirror-setup-intro";

    intro.textContent =
      "Let's set up your mirror.";


    panel.appendChild(title);
    panel.appendChild(intro);


    /*
     * USER NAME
     */

    const userName =
      this.createSetupField(
        panel,
        "Your name",
        "text",
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
        "Clovis, New Mexico"
      );


    /*
     * VOICE STYLE
     */

    const voiceLabel =
      document.createElement("label");

    voiceLabel.textContent =
      "Voice style";


    const voice =
      document.createElement("select");


    const voiceChoices = [
      {
        value: "hal",
        name: "HAL-style — calm and deliberate"
      },
      {
        value: "natural",
        name: "Natural"
      },
      {
        value: "warm",
        name: "Warm"
      },
      {
        value: "direct",
        name: "Direct"
      },
      {
        value: "formal",
        name: "Formal"
      }
    ];


    voiceChoices.forEach(
      (choice) => {

        const option =
          document.createElement("option");

        option.value =
          choice.value;

        option.textContent =
          choice.name;


        voice.appendChild(option);
      }
    );


    voice.value = "hal";

    panel.appendChild(voiceLabel);
    panel.appendChild(voice);


    /*
     * AI MODEL
     */

    const modelLabel =
      document.createElement("label");

    modelLabel.textContent =
      "AI model";


    const model =
      document.createElement("select");


    const automatic =
      document.createElement("option");

    automatic.value = "auto";

    automatic.textContent =
      "Automatic — recommended";


    model.appendChild(automatic);


    /*
     * Later the backend can retrieve the actual
     * models available to the user's API account.
     */

    model.value = "auto";


    panel.appendChild(modelLabel);
    panel.appendChild(model);


    /*
     * OPENAI API KEY
     */

    const apiKey =
      this.createSetupField(
        panel,
        "OpenAI API key",
        "password",
        ""
      );


    apiKey.placeholder =
      "Optional for now";


    /*
     * SECURITY NOTE
     */

    const security =
      document.createElement("div");

    security.className =
      "mirror-setup-security";

    security.textContent =
      "Your API key will be stored privately on this device and will not be placed in the GitHub repository.";


    panel.appendChild(security);


    /*
     * ERROR / STATUS MESSAGE
     */

    if (this.setupMessage) {

      const message =
        document.createElement("div");

      message.className =
        "mirror-setup-message";

      message.textContent =
        this.setupMessage;

      panel.appendChild(message);
    }


    /*
     * SAVE BUTTON
     */

    const button =
      document.createElement("button");

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


        /*
         * Require only the two most basic fields.
         */

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


        /*
         * Send everything to node_helper.js.
         */

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


    panel.appendChild(button);

    wrapper.appendChild(panel);

    return wrapper;
  },


  /*
   * HELPER FUNCTION FOR SETUP INPUTS
   *
   * Saves us from repeating the same HTML code.
   */

  createSetupField(
    panel,
    labelText,
    inputType,
    defaultValue
  ) {

    const label =
      document.createElement("label");

    label.textContent =
      labelText;


    const input =
      document.createElement("input");

    input.type =
      inputType;

    input.value =
      defaultValue;


    panel.appendChild(label);
    panel.appendChild(input);


    return input;
  },


  /*
   * NORMAL MIRROR DISPLAY
   */

  buildMirrorScreen() {

    const wrapper =
      document.createElement("div");

    wrapper.className =
      "mirror-controller";


    /*
     * MAIN MIRROR AREA
     */

    const mainDisplay =
      document.createElement("main");

    mainDisplay.className =
      "mirror-main-display";


    if (this.selectedStory) {

      const expandedCard =
        document.createElement("article");

      expandedCard.className =
        "mirror-expanded-card";


      const title =
        document.createElement("h1");

      title.textContent =
        this.selectedStory.title;


      const body =
        document.createElement("p");

      body.textContent =
        this.selectedStory.detail;


      expandedCard.appendChild(title);

      expandedCard.appendChild(body);

      mainDisplay.appendChild(
        expandedCard
      );
    }


    /*
     * RIGHT RAIL
     */

    const rightRail =
      document.createElement("aside");

    rightRail.className =
      "mirror-right-rail";


    const now =
      new Date();


    /*
     * TIME
     */

    const time =
      document.createElement("div");

    time.className =
      "mirror-time";

    time.textContent =
      new Intl.DateTimeFormat(
        "en-US",
        {
          hour: "numeric",
          minute: "2-digit",
          hour12: true
        }
      ).format(now);


    /*
     * WEATHER
     */

    const weather =
      document.createElement("div");

    weather.className =
      "mirror-weather";


    const temperature =
      document.createElement("span");

    temperature.textContent =
      this.config.weather.temperature;


    const rain =
      document.createElement("span");

    rain.className =
      "mirror-rain";

    rain.textContent =
      `Rain ${this.config.weather.rainChance}`;


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
      document.createElement("div");

    date.className =
      "mirror-date";

    date.textContent =
      new Intl.DateTimeFormat(
        "en-US",
        {
          weekday: "long",
          month: "long",
          day: "numeric"
        }
      ).format(now);


    /*
     * HEADLINES
     */

    const headlines =
      document.createElement("div");

    headlines.className =
      "mirror-headlines";


    this.config.headlines.forEach(
      (story) => {

        const headline =
          document.createElement("button");

        headline.className =
          "mirror-headline";

        headline.textContent =
          story.title;


        if (
          this.selectedStory &&
          this.selectedStory.title ===
            story.title
        ) {
          headline.classList.add(
            "active"
          );
        }


        headline.addEventListener(
          "click",
          () => {

            this.selectedStory =
              story;


            this.spokenText =
              `Here's the story: ${story.title}.`;


            this.updateDom(200);
          }
        );


        headlines.appendChild(
          headline
        );
      }
    );


    rightRail.appendChild(time);

    rightRail.appendChild(weather);

    rightRail.appendChild(date);

    rightRail.appendChild(headlines);


    /*
     * BOTTOM AI RESPONSE
     */

    const responseArea =
      document.createElement("section");

    responseArea.className =
      "mirror-response";


    const voiceName =
      document.createElement("div");

    voiceName.className =
      "mirror-voice-name";

    voiceName.textContent =
      this.config.mirrorName;


    const caption =
      document.createElement("div");

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
     * BUILD FINAL SCREEN
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

WHAT CHANGED IN THIS VERSION:

The mirror now has TWO MODES:

1. SETUP MODE
2. NORMAL MIRROR MODE


WHEN THE MIRROR STARTS:

MMM-MirrorController.js sends this message:

    MIRROR_GET_SETUP

to:

    node_helper.js


The backend checks whether setup information
has already been saved.


IF SETUP HAS NEVER BEEN COMPLETED:

The screen displays a form asking for:

- your name
- mirror name
- location
- voice style
- AI model
- OpenAI API key


WHEN YOU CLICK "FINISH SETUP":

The screen sends:

    MIRROR_SAVE_SETUP

to node_helper.js.


THE BACKEND SAVES THE INFORMATION.

It then sends:

    MIRROR_SETUP_SAVED


The visible screen then switches from setup mode
to the normal mirror.


IMPORTANT SECURITY DETAIL:

The API key exists temporarily inside the password
box while setup is being completed.

After the form is submitted, it is sent to
node_helper.js.

node_helper.js stores it privately.

The API key is NOT saved inside this JavaScript file.


WHAT setupLoaded MEANS:

    this.setupLoaded

means:

"Has the backend answered us yet?"


WHAT setupComplete MEANS:

    this.setupComplete

means:

"Has the user completed first-boot setup?"


WHY WE HAVE buildSetupScreen():

Instead of putting everything inside getDom(),
we split the screen into smaller functions.

This makes the program easier to understand.


THE MAJOR SCREEN FUNCTIONS ARE:

    buildLoadingScreen()

Shows:

    Starting mirror...


    buildSetupScreen()

Shows the first-boot setup.


    buildMirrorScreen()

Shows the actual everyday mirror.


HOW TO ADD ANOTHER SETUP QUESTION:

Inside:

    buildSetupScreen()

add another field.

Then include that value in:

    MIRROR_SAVE_SETUP

And update node_helper.js so it knows how to
save that setting.


HOW TO CHANGE THE NORMAL MIRROR:

Use:

    buildMirrorScreen()


HOW TO CHANGE HOW THINGS LOOK:

Use:

    MMM-MirrorController.css


NEXT BIG STEP:

We need to add CSS for the new first-boot setup screen.

After that we'll connect MMM-MirrorController
to MagicMirror's config so the module actually loads.

===============================================================================
*/
