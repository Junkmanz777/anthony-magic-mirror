Module.register("MMM-MirrorController", {
  defaults: {
    mirrorName: "HAL",

    weather: {
      temperature: "72°F",
      rainChance: "20%"
    },

    headlines: [
      {
        title: "New Mexico man fires gun during dispute",
        detail:
          "This is temporary sample content. Later the Daily Buzz system will provide the real story."
      },
      {
        title: "Storm warning issued for Curry County",
        detail:
          "Weather information and other details can appear here when this headline is selected."
      },
      {
        title: "Major national story develops overnight",
        detail:
          "The center display is reserved for longer information when you ask for it."
      },
      {
        title: "Clovis council considers new proposal",
        detail:
          "Local stories will be included in the Daily Buzz."
      },
      {
        title: "Today's Scripture: Proverbs 27:6",
        detail:
          "Faith-related content can appear as one of the day's selectable items."
      }
    ]
  },

  start() {
    Log.info("Starting MMM-MirrorController");

    this.selectedStory = null;
    this.spokenText = "Ready.";

    // Refresh periodically so the clock stays current.
    this.clockTimer = setInterval(() => {
      this.updateDom(0);
    }, 15000);
  },

  getStyles() {
    return ["MMM-MirrorController.css"];
  },

  getDom() {
    const wrapper = document.createElement("div");
    wrapper.className = "mirror-controller";

    /*
     * MAIN MIRROR AREA
     *
     * Normally this stays empty so the person can see themselves.
     * It only shows content when a story or request needs more space.
     */
    const mainDisplay = document.createElement("main");
    mainDisplay.className = "mirror-main-display";

    if (this.selectedStory) {
      const expandedCard = document.createElement("article");
      expandedCard.className = "mirror-expanded-card";

      const title = document.createElement("h1");
      title.textContent = this.selectedStory.title;

      const body = document.createElement("p");
      body.textContent = this.selectedStory.detail;

      expandedCard.appendChild(title);
      expandedCard.appendChild(body);
      mainDisplay.appendChild(expandedCard);
    }

    /*
     * RIGHT SIDE
     *
     * Time
     * Temperature / rain chance
     * Date
     * Today's selectable headlines
     */
    const rightRail = document.createElement("aside");
    rightRail.className = "mirror-right-rail";

    const now = new Date(Date.now());

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
    temperature.textContent = this.config.weather.temperature;

    const rain = document.createElement("span");
    rain.className = "mirror-rain";
    rain.textContent = `Rain ${this.config.weather.rainChance}`;

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

    this.config.headlines.forEach((story) => {
      const headline = document.createElement("button");

      headline.className = "mirror-headline";
      headline.textContent = story.title;

      if (
        this.selectedStory &&
        this.selectedStory.title === story.title
      ) {
        headline.classList.add("active");
      }

      headline.addEventListener("click", () => {
        this.selectedStory = story;

        this.spokenText =
          `Here's the story: ${story.title}.`;

        this.updateDom(200);
      });

      headlines.appendChild(headline);
    });

    rightRail.appendChild(time);
    rightRail.appendChild(weather);
    rightRail.appendChild(date);
    rightRail.appendChild(headlines);

    /*
     * BOTTOM RESPONSE AREA
     *
     * Eventually this will display what the AI is currently saying.
     * CSS will enforce the maximum five-line rule.
     */
    const responseArea = document.createElement("section");
    responseArea.className = "mirror-response";

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

WHAT THIS FILE DOES:

This is the main front-end controller for the mirror screen.

MagicMirror loads this file and runs:

    Module.register("MMM-MirrorController", ...)

The module then creates the pieces you see on the screen.

The screen has three major areas:

1. mirror-main-display
   The large center/left portion.
   Normally this is empty so the mirror stays usable.

2. mirror-right-rail
   The narrow section on the right.
   It contains:
   - time
   - temperature
   - rain chance
   - date
   - Daily Buzz headlines

3. mirror-response
   The strip across the bottom.
   Eventually this displays what the AI is saying.


WHERE THE DATA COMES FROM RIGHT NOW:

The weather and headlines near the top of this file are FAKE TEST DATA.

For example:

    temperature: "72°F"

Later node_helper.js will retrieve real information and send it here.


HOW TO CHANGE THE MIRROR'S DEFAULT NAME:

Change:

    mirrorName: "HAL"

For example:

    mirrorName: "Jarvis"


HOW TO CHANGE THE SAMPLE HEADLINES:

Look for:

    headlines: [

Each story has:

    title:
    detail:

"title" appears on the right side.

"detail" appears in the large center display after the story is selected.


HOW THE CENTER SCREEN WORKS:

Normally:

    this.selectedStory = null

That means nothing appears in the center.

When a headline is clicked, selectedStory becomes that story.

MagicMirror then calls:

    this.updateDom()

That causes the screen to redraw.


HOW TO MAKE MAJOR CHANGES:

If we want to change WHAT information the mirror displays,
we usually change THIS JavaScript file.

If we want to change HOW it looks — sizes, spacing, position,
fonts, etc. — we change:

    MMM-MirrorController.css

If we want to talk to the internet, OpenAI, weather services,
save settings, or handle private API keys, we use:

    node_helper.js


IMPORTANT:

Do not put an OpenAI API key in this file.

This file runs on the visible/browser side of MagicMirror.
Secrets belong in the private backend.

===============================================================================
*/
