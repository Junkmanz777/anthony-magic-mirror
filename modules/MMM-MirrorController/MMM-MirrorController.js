Module.register("MMM-MirrorController", {
  defaults: {
    mirrorName: "HAL",
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

    this.weatherState = { ...this.config.weather };
    this.headlinesState = [...this.config.headlines];
    this.selectedStory = null;
    this.centerContent = null;

    this.spokenText = "Ready. Press V to talk.";
    this.setupLoaded = false;
    this.setupComplete = false;
    this.setupState = null;
    this.setupMessage = "";

    this.voiceBusy = false;
    this.voicePhase = "idle";

    this.sendSocketNotification("MIRROR_GET_SETUP");

    this.clockTimer = setInterval(() => {
      if (this.setupComplete) this.updateDom(0);
    }, 15000);

    this.keyHandler = (event) => {
      if (!this.setupComplete || !event) return;
      if (String(event.key || "").toLowerCase() !== "v") return;

      if (this.voiceBusy) {
        this.interruptAndListen();
      } else {
        this.startVoiceTurn();
      }
    };

    window.addEventListener("keydown", this.keyHandler);
  },

  suspend() {
    if (this.keyHandler) {
      window.removeEventListener("keydown", this.keyHandler);
    }
    if (this.clockTimer) clearInterval(this.clockTimer);
  },

  getStyles() {
    return ["MMM-MirrorController.css"];
  },

  startVoiceTurn() {
    if (this.voiceBusy) {
      this.interruptAndListen();
      return;
    }

    this.voiceBusy = true;
    this.voicePhase = "listening";
    this.spokenText = "Listening...";
    this.updateDom(120);
    this.sendSocketNotification("MIRROR_START_VOICE");
  },

  interruptAndListen() {
    this.voiceBusy = true;
    this.voicePhase = "stopping";
    this.spokenText = "Stopping...";
    this.updateDom(80);
    this.sendSocketNotification("MIRROR_INTERRUPT_VOICE");
  },

  applyScreenAction(action = {}) {
    switch (action.type) {
      case "set_weather":
        this.weatherState = {
          temperature: String(action.temperature || "--°F"),
          rainChance: String(action.rainChance || "--%")
        };
        break;

      case "set_daily_buzz":
        if (Array.isArray(action.items) && action.items.length) {
          this.headlinesState = action.items
            .map((item) => ({
              category: String(item?.category || "buzz"),
              title: String(item?.title || "").trim(),
              detail: String(item?.detail || "").trim()
            }))
            .filter((item) => item.title);

          this.selectedStory = null;
        }
        break;

      case "show_center":
        this.selectedStory = null;
        this.centerContent = {
          title: String(action.title || "").trim(),
          body: String(action.body || "").trim()
        };
        break;

      case "clear_center":
        this.selectedStory = null;
        this.centerContent = null;
        break;

      case "set_caption":
        this.spokenText = String(action.text || "").trim();
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
      } else {
        this.setupMessage = payload?.error || "Setup could not be saved.";
      }

      this.updateDom(300);
      return;
    }

    if (notification === "MIRROR_SCREEN_ACTION") {
      this.applyScreenAction(payload);
      return;
    }

    if (notification === "MIRROR_SCREEN_STATE") {
      if (payload?.weather) {
        this.weatherState = {
          ...this.weatherState,
          ...payload.weather
        };
      }

      if (Array.isArray(payload?.headlines)) {
        this.headlinesState = payload.headlines;
      }

      if (Object.prototype.hasOwnProperty.call(payload || {}, "center")) {
        this.centerContent = payload.center;
      }

      this.updateDom(150);
      return;
    }

    if (notification === "MIRROR_VOICE_STATUS") {
      if (payload?.message && payload?.replaceCaption !== false) {
        this.spokenText = payload.message;
      }

      if (typeof payload?.busy === "boolean") {
        this.voiceBusy = payload.busy;
      }

      if (payload?.phase) {
        this.voicePhase = String(payload.phase);
      }

      this.updateDom(120);
      return;
    }

    if (notification === "MIRROR_VOICE_RESULT") {
      /*
       * The backend sends both:
       *   response = full text HAL will speak
       *   caption  = short text for the bottom of the mirror
       *
       * Do NOT set voiceBusy false here. HAL may still be speaking.
       */
      this.spokenText =
        payload?.caption ||
        payload?.response ||
        "I received the request, but no answer came back.";

      this.updateDom(120);
      return;
    }

    if (notification === "MIRROR_VOICE_ERROR") {
      this.voiceBusy = false;
      this.voicePhase = "idle";
      this.spokenText = payload?.error || "Voice request failed.";
      this.updateDom(120);
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
    if (!this.setupLoaded) return this.buildLoadingScreen();
    if (!this.setupComplete) return this.buildSetupScreen();
    return this.buildMirrorScreen();
  },

  buildLoadingScreen() {
    const wrapper = document.createElement("div");
    wrapper.className = "mirror-loading-screen";

    const text = document.createElement("div");
    text.className = "mirror-loading-text";
    text.textContent = "Starting mirror...";

    wrapper.appendChild(text);
    return wrapper;
  },

  buildSetupScreen() {
    const wrapper = document.createElement("div");
    wrapper.className = "mirror-setup-screen";

    const panel = document.createElement("div");
    panel.className = "mirror-setup-panel";

    const title = document.createElement("h1");
    title.textContent = "Welcome";

    const intro = document.createElement("p");
    intro.className = "mirror-setup-intro";
    intro.textContent = "Let's set up your mirror.";

    panel.appendChild(title);
    panel.appendChild(intro);

    const saved = this.setupState?.settings || {};

    const userName = this.createSetupField(
      panel,
      "Your name",
      "text",
      saved.userName || "Anthony"
    );

    const mirrorName = this.createSetupField(
      panel,
      "What do you want to call the mirror?",
      "text",
      saved.mirrorName || "HAL"
    );

    const location = this.createSetupField(
      panel,
      "Location",
      "text",
      saved.location || "Clovis, New Mexico"
    );

    const voiceLabel = document.createElement("label");
    voiceLabel.textContent = "Voice style";

    const voice = document.createElement("select");
    [
      ["hal", "HAL-style — calm and deliberate"],
      ["natural", "Natural"],
      ["warm", "Warm"],
      ["direct", "Direct"],
      ["formal", "Formal"]
    ].forEach(([value, name]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = name;
      voice.appendChild(option);
    });

    voice.value = saved.voice || "hal";
    panel.appendChild(voiceLabel);
    panel.appendChild(voice);

    const modelLabel = document.createElement("label");
    modelLabel.textContent = "AI model";

    const model = document.createElement("select");
    const automatic = document.createElement("option");
    automatic.value = "auto";
    automatic.textContent = "Automatic — recommended";
    model.appendChild(automatic);
    model.value = saved.model || "auto";

    panel.appendChild(modelLabel);
    panel.appendChild(model);

    const apiKey = this.createSetupField(
      panel,
      "OpenAI API key",
      "password",
      ""
    );

    apiKey.placeholder = this.setupState?.apiKeyConfigured
      ? "Already configured — leave blank to keep it"
      : "Optional for now";

    const security = document.createElement("div");
    security.className = "mirror-setup-security";
    security.textContent =
      "Your API key is stored privately on this device and is not placed in the GitHub repository.";
    panel.appendChild(security);

    if (this.setupMessage) {
      const message = document.createElement("div");
      message.className = "mirror-setup-message";
      message.textContent = this.setupMessage;
      panel.appendChild(message);
    }

    const button = document.createElement("button");
    button.className = "mirror-setup-button";
    button.textContent = "Finish Setup";

    button.addEventListener("click", () => {
      const cleanUserName = userName.value.trim();
      const cleanMirrorName = mirrorName.value.trim();

      if (!cleanUserName) {
        this.setupMessage = "Please enter your name.";
        this.updateDom(200);
        return;
      }

      if (!cleanMirrorName) {
        this.setupMessage = "Please give the mirror a name.";
        this.updateDom(200);
        return;
      }

      this.setupMessage = "Saving setup...";

      this.sendSocketNotification("MIRROR_SAVE_SETUP", {
        userName: cleanUserName,
        mirrorName: cleanMirrorName,
        location: location.value.trim(),
        voice: voice.value,
        model: model.value,
        apiKey: apiKey.value.trim()
      });

      this.updateDom(200);
    });

    panel.appendChild(button);
    wrapper.appendChild(panel);
    return wrapper;
  },

  createSetupField(panel, labelText, inputType, defaultValue) {
    const label = document.createElement("label");
    label.textContent = labelText;

    const input = document.createElement("input");
    input.type = inputType;
    input.value = defaultValue;

    panel.appendChild(label);
    panel.appendChild(input);
    return input;
  },

  buildCenterCard(mainDisplay) {
    const content =
      this.centerContent ||
      (this.selectedStory
        ? {
            title: this.selectedStory.title,
            body: this.selectedStory.detail
          }
        : null);

    if (!content) return;

    const expandedCard = document.createElement("article");
    expandedCard.className = "mirror-expanded-card";

    const title = document.createElement("h1");
    title.textContent = content.title || "";

    const body = document.createElement("p");
    body.textContent = content.body || "";

    expandedCard.appendChild(title);
    expandedCard.appendChild(body);
    mainDisplay.appendChild(expandedCard);
  },

  buildMirrorScreen() {
    const wrapper = document.createElement("div");
    wrapper.className = "mirror-controller";

    const mainDisplay = document.createElement("main");
    mainDisplay.className = "mirror-main-display";
    this.buildCenterCard(mainDisplay);

    const rightRail = document.createElement("aside");
    rightRail.className = "mirror-right-rail";

    const now = new Date();

    const time = document.createElement("div");
    time.className = "mirror-time";
    time.textContent = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    }).format(now);

    const weather = document.createElement("div");
    weather.className = "mirror-weather";

    const temperature = document.createElement("span");
    temperature.textContent = this.weatherState.temperature;

    const rain = document.createElement("span");
    rain.className = "mirror-rain";
    rain.textContent = `Rain ${this.weatherState.rainChance}`;

    weather.appendChild(temperature);
    weather.appendChild(rain);

    const date = document.createElement("div");
    date.className = "mirror-date";
    date.textContent = new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric"
    }).format(now);

    const headlines = document.createElement("div");
    headlines.className = "mirror-headlines";

    this.headlinesState.forEach((story) => {
      const headline = document.createElement("button");
      headline.className = "mirror-headline";
      headline.textContent = story.title;

      if (this.selectedStory?.title === story.title) {
        headline.classList.add("active");
      }

      headline.addEventListener("click", () => {
        this.centerContent = null;
        this.selectedStory = story;
        this.spokenText = `Ask me about: ${story.title}`;

        this.sendSocketNotification("MIRROR_SELECT_STORY", {
          title: story.title
        });

        this.updateDom(200);
      });

      headlines.appendChild(headline);
    });

    rightRail.appendChild(time);
    rightRail.appendChild(weather);
    rightRail.appendChild(date);
    rightRail.appendChild(headlines);

    const responseArea = document.createElement("section");
    responseArea.className = "mirror-response";
    responseArea.title = this.voiceBusy
      ? "Press V or click here to interrupt HAL and talk"
      : "Press V or click here to talk";

    responseArea.addEventListener("click", () => {
      if (this.voiceBusy) {
        this.interruptAndListen();
      } else {
        this.startVoiceTurn();
      }
    });

    const voiceName = document.createElement("div");
    voiceName.className = "mirror-voice-name";
    voiceName.textContent = this.config.mirrorName;

    const caption = document.createElement("div");
    caption.className = "mirror-caption";
    caption.textContent = this.spokenText;

    responseArea.appendChild(voiceName);
    responseArea.appendChild(caption);

    wrapper.appendChild(mainDisplay);
    wrapper.appendChild(rightRail);
    wrapper.appendChild(responseArea);

    return wrapper;
  }
});


/*
===============================================================================
NOTES TO A NEWBIE PROGRAMMER
===============================================================================

WHAT THIS VERSION ADDS:

1. HAL CAN BE INTERRUPTED.

   While HAL is busy, press V again or click the bottom response bar.
   The front end sends MIRROR_INTERRUPT_VOICE to node_helper.js.
   The backend stops the old voice turn and immediately starts listening again.

2. THE BOTTOM BAR IS A CAPTION, NOT A TRANSCRIPT.

   The backend still sends the complete answer to the speaker, but it also sends
   a short caption. MIRROR_VOICE_RESULT displays payload.caption at the bottom.

3. voiceBusy STAYS TRUE WHILE HAL IS ACTUALLY SPEAKING.

   MIRROR_VOICE_RESULT no longer marks HAL idle. The backend sends the final
   idle status after audio playback really ends.

The existing screen-control actions remain available:

    set_weather
    set_daily_buzz
    show_center
    clear_center
    set_caption

The OpenAI API key still never belongs in this browser-side file.

===============================================================================
*/
