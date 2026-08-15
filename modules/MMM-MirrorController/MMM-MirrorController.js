
Module.register("MMM-MirrorController", {
  defaults: {
    mirrorName: "HAL",
    weather: { temperature: "--°F", rainChance: "--%" },
    headlines: [{
      title: "Daily Buzz is not loaded yet",
      detail: "Later, this area will contain today's real Daily Buzz stories."
    }]
  },

  start() {
    Log.info("Starting MMM-MirrorController");
    this.selectedStory = null;
    this.spokenText = "Ready. Press V to talk.";
    this.setupLoaded = false;
    this.setupComplete = false;
    this.setupState = null;
    this.setupMessage = "";
    this.voiceBusy = false;

    this.sendSocketNotification("MIRROR_GET_SETUP");

    this.clockTimer = setInterval(() => {
      if (this.setupComplete) this.updateDom(0);
    }, 15000);

    this.keyHandler = (event) => {
      if (
        this.setupComplete &&
        !this.voiceBusy &&
        event &&
        String(event.key || "").toLowerCase() === "v"
      ) {
        this.startVoiceTurn();
      }
    };

    window.addEventListener("keydown", this.keyHandler);
  },

  suspend() {
    if (this.keyHandler) window.removeEventListener("keydown", this.keyHandler);
    if (this.clockTimer) clearInterval(this.clockTimer);
  },

  getStyles() {
    return ["MMM-MirrorController.css"];
  },

  startVoiceTurn() {
    if (this.voiceBusy) return;
    this.voiceBusy = true;
    this.spokenText = "Listening...";
    this.updateDom(150);
    this.sendSocketNotification("MIRROR_START_VOICE");
  },

  socketNotificationReceived(notification, payload) {
    if (notification === "MIRROR_SETUP_STATE") {
      this.setupLoaded = true;
      this.setupState = payload;
      this.setupComplete = Boolean(payload && payload.setupComplete);

      if (payload?.settings?.mirrorName) {
        this.config.mirrorName = payload.settings.mirrorName;
      }

      if (this.setupComplete) {
        this.spokenText = payload?.apiKeyConfigured
          ? "Ready. Press V to talk."
          : "Ready. OpenAI API key is not configured.";
      }

      this.updateDom(300);
      return;
    }

    if (notification === "MIRROR_SETUP_SAVED") {
      if (payload?.success) {
        this.setupComplete = true;
        this.setupState = payload;

        if (payload?.settings?.mirrorName) {
          this.config.mirrorName = payload.settings.mirrorName;
        }

        this.spokenText = payload.apiKeyConfigured
          ? `Setup complete. ${this.config.mirrorName} is ready. Press V to talk.`
          : `Setup complete. ${this.config.mirrorName} is ready, but the OpenAI API key is not configured.`;

        this.updateDom(500);
      } else {
        this.setupMessage =
          payload?.error || "Setup could not be saved.";

        this.updateDom(300);
      }

      return;
    }

    if (notification === "MIRROR_VOICE_STATUS") {
      if (
        payload?.message &&
        payload?.replaceCaption !== false
      ) {
        this.spokenText = payload.message;
      }

      if (typeof payload?.busy === "boolean") {
        this.voiceBusy = payload.busy;
      }

      this.updateDom(150);
      return;
    }

    if (notification === "MIRROR_VOICE_RESULT") {
      this.voiceBusy = false;

      this.spokenText =
        payload?.response ||
        "I received the request, but no answer came back.";

      this.updateDom(150);
      return;
    }

    if (notification === "MIRROR_VOICE_ERROR") {
      this.voiceBusy = false;

      this.spokenText =
        payload?.error ||
        "Voice request failed.";

      this.updateDom(150);
      return;
    }

    if (notification === "MIRROR_PONG") {
      Log.info(
        "[MMM-MirrorController]",
        payload?.message || "Backend responded."
      );
    }
  },

  getDom() {
    if (!this.setupLoaded) {
      return this.buildLoadingScreen();
    }

    if (!this.setupComplete) {
      return this.buildSetupScreen();
    }

    return this.buildMirrorScreen();
  },

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

  buildSetupScreen() {
    const wrapper =
      document.createElement("div");

    wrapper.className =
      "mirror-setup-screen";

    const panel =
      document.createElement("div");

    panel.className =
      "mirror-setup-panel";

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

    const saved =
      this.setupState?.settings || {};

    const userName =
      this.createSetupField(
        panel,
        "Your name",
        "text",
        saved.userName || "Anthony"
      );

    const mirrorName =
      this.createSetupField(
        panel,
        "What do you want to call the mirror?",
        "text",
        saved.mirrorName || "HAL"
      );

    const location =
      this.createSetupField(
        panel,
        "Location",
        "text",
        saved.location || "Clovis, New Mexico"
      );

    const voiceLabel =
      document.createElement("label");

    voiceLabel.textContent =
      "Voice style";

    const voice =
      document.createElement("select");

    [
      ["hal", "HAL-style — calm and deliberate"],
      ["natural", "Natural"],
      ["warm", "Warm"],
      ["direct", "Direct"],
      ["formal", "Formal"]
    ].forEach(([value, name]) => {
      const option =
        document.createElement("option");

      option.value = value;
      option.textContent = name;

      voice.appendChild(option);
    });

    voice.value =
      saved.voice || "hal";

    panel.appendChild(voiceLabel);
    panel.appendChild(voice);

    const modelLabel =
      document.createElement("label");

    modelLabel.textContent =
      "AI model";

    const model =
      document.createElement("select");

    const automatic =
      document.createElement("option");

    automatic.value =
      "auto";

    automatic.textContent =
      "Automatic — recommended";

    model.appendChild(automatic);

    model.value =
      saved.model || "auto";

    panel.appendChild(modelLabel);
    panel.appendChild(model);

    const apiKey =
      this.createSetupField(
        panel,
        "OpenAI API key",
        "password",
        ""
      );

    apiKey.placeholder =
      this.setupState?.apiKeyConfigured
        ? "Already configured — leave blank to keep it"
        : "Optional for now";

    const security =
      document.createElement("div");

    security.className =
      "mirror-setup-security";

    security.textContent =
      "Your API key is stored privately on this device and is not placed in the GitHub repository.";

    panel.appendChild(security);

    if (this.setupMessage) {
      const message =
        document.createElement("div");

      message.className =
        "mirror-setup-message";

      message.textContent =
        this.setupMessage;

      panel.appendChild(message);
    }

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

    panel.appendChild(button);
    wrapper.appendChild(panel);

    return wrapper;
  },

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

  buildMirrorScreen() {
    const wrapper =
      document.createElement("div");

    wrapper.className =
      "mirror-controller";

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
      mainDisplay.appendChild(expandedCard);
    }

    const rightRail =
      document.createElement("aside");

    rightRail.className =
      "mirror-right-rail";

    const now =
      new Date();

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
          this.selectedStory?.title ===
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

    const responseArea =
      document.createElement("section");

    responseArea.className =
      "mirror-response";

    responseArea.title =
      "Press V or click here to talk";

    responseArea.addEventListener(
      "click",
      () => this.startVoiceTurn()
    );

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

WHAT THIS VERSION ADDS:

Press V on the keyboard, or click the response bar at the bottom.

The screen sends MIRROR_START_VOICE to node_helper.js.

The backend then records from the WM8960 microphones, transcribes the
recording, asks OpenAI, speaks the answer, and sends the answer back here.


WHY DOES THE CLOCK TIMER CHECK setupComplete?

The old code rebuilt the setup form every 15 seconds while somebody was
typing. That is why the API key kept disappearing.

Now the clock refresh happens only AFTER setup is complete.


WHY START WITH THE V KEY?

Hands-free wake-word listening adds another moving part.

First we prove the complete microphone -> AI -> speaker chain. Then we can
add automatic wake-word / voice-activity listening without guessing which
part failed.


IMPORTANT:

The OpenAI API key never belongs in this file.

It stays only on the Raspberry Pi at:

    ~/.config/anthony-magic-mirror/openai_api_key

===============================================================================
*/
