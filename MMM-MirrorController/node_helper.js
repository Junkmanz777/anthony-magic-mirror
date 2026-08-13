const NodeHelper = require("node_helper");
const Log = require("logger");

const fs = require("fs");
const os = require("os");
const path = require("path");


/*
 * PRIVATE STORAGE LOCATION
 *
 * These files live on the Raspberry Pi itself.
 * They are NOT stored inside the GitHub repository.
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


module.exports = NodeHelper.create({

  /*
   * START
   *
   * MagicMirror calls this when the backend starts.
   */

  start() {
    Log.log(
      "[MMM-MirrorController] Backend starting..."
    );

    this.ensurePrivateStorage();

    Log.log(
      "[MMM-MirrorController] Backend ready."
    );
  },


  /*
   * CREATE PRIVATE STORAGE
   *
   * Creates:
   *
   * ~/.config/anthony-magic-mirror/
   *
   * Permissions are restricted to the Pi user.
   */

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


  /*
   * DEFAULT SETTINGS
   *
   * These are used before first-boot setup is completed.
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
    const defaults = this.getDefaultSettings();

    if (!fs.existsSync(SETTINGS_FILE)) {
      return defaults;
    }

    try {
      const stored = JSON.parse(
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
   *
   * We deliberately choose which fields can be saved.
   *
   * This prevents random information or secrets from
   * accidentally being written into settings.json.
   */

  saveSettings(payload = {}) {
    const settings = {
      userName:
        String(payload.userName || "").trim(),

      mirrorName:
        String(payload.mirrorName || "HAL").trim(),

      location:
        String(
          payload.location ||
          "Clovis, New Mexico"
        ).trim(),

      voice:
        String(payload.voice || "hal").trim(),

      model:
        String(payload.model || "auto").trim()
    };

    fs.writeFileSync(
      SETTINGS_FILE,
      JSON.stringify(settings, null, 2),
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
   * SAVE OPENAI API KEY
   *
   * IMPORTANT:
   *
   * The API key is stored separately from normal settings.
   *
   * We NEVER send the actual key back to the display.
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


  /*
   * CHECK WHETHER AN API KEY EXISTS
   *
   * This only answers true or false.
   *
   * It does NOT reveal the key.
   */

  apiKeyConfigured() {
    try {
      if (!fs.existsSync(API_KEY_FILE)) {
        return false;
      }

      const key = fs
        .readFileSync(
          API_KEY_FILE,
          "utf8"
        )
        .trim();

      return key.length > 0;

    } catch (error) {
      return false;
    }
  },


  /*
   * BUILD THE SETUP STATUS
   *
   * This is safe to send to the visible screen.
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
   * RECEIVE MESSAGES FROM THE DISPLAY
   *
   * MMM-MirrorController.js will eventually send these.
   */

  socketNotificationReceived(
    notification,
    payload
  ) {

    /*
     * Simple test to prove communication works.
     */

    if (notification === "MIRROR_PING") {

      this.sendSocketNotification(
        "MIRROR_PONG",
        {
          message: "Backend is alive."
        }
      );

      return;
    }


    /*
     * Front end asks:
     *
     * "Has first-boot setup been completed?"
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
     * First-boot setup screen sends settings.
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
          payload &&
          payload.apiKey
        ) {
          this.saveApiKey(
            payload.apiKey
          );
        }


        this.sendSocketNotification(
          "MIRROR_SETUP_SAVED",
          {
            success: true,

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
            success: false,

            error:
              "Could not save mirror setup."
          }
        );
      }
    }
  }
});


/*
===============================================================================
NOTES TO A NEWBIE PROGRAMMER
===============================================================================

WHAT THIS FILE DOES:

This is the BACKEND of the mirror.

MMM-MirrorController.js runs on the visible screen.

node_helper.js runs behind the scenes.

Think of it like this:

    SCREEN
      |
      |
      v
MMM-MirrorController.js
      |
      | messages
      |
      v
node_helper.js
      |
      +---- files
      +---- weather
      +---- OpenAI
      +---- internet services


WHY WE NEED A BACKEND:

Some things should NOT happen directly on the visible screen.

For example:

- storing API keys
- calling OpenAI
- saving settings
- reading private files
- talking to external services


WHERE SETTINGS ARE SAVED:

On the Raspberry Pi:

~/.config/anthony-magic-mirror/settings.json


That file might eventually look like:

{
  "userName": "Anthony",
  "mirrorName": "HAL",
  "location": "Clovis, New Mexico",
  "voice": "hal",
  "model": "auto"
}


WHERE THE OPENAI API KEY IS SAVED:

Separately:

~/.config/anthony-magic-mirror/openai_api_key


WHY IS THE API KEY SEPARATE?

Because API keys are secrets.

We do NOT want them:

- inside GitHub
- inside config.example.js
- displayed on screen
- accidentally logged


WHAT DOES 0o600 MEAN?

It is a Linux file permission.

0o600 means:

OWNER:
  read
  write

EVERYONE ELSE:
  no access


WHAT DOES 0o700 MEAN?

For the private folder:

OWNER:
  read
  write
  enter

EVERYONE ELSE:
  no access


HOW THE FRONT END TALKS TO THIS FILE:

The screen can send:

MIRROR_PING

MIRROR_GET_SETUP

MIRROR_SAVE_SETUP


This backend responds with:

MIRROR_PONG

MIRROR_SETUP_STATE

MIRROR_SETUP_SAVED


HOW TO ADD A NEW BACKEND COMMAND:

Inside:

socketNotificationReceived()

add another section like:

if (notification === "MY_NEW_COMMAND") {

  // Do something here.

}


WHERE OPENAI WILL GO:

Later we will add functions such as:

askOpenAI()

startVoiceSession()

getAvailableModels()


WHERE WEATHER WILL GO:

Later we can add something like:

getWeather()


WHERE DAILY BUZZ WILL GO:

Eventually the backend can:

1. gather information
2. ask the AI to organize it
3. create short headlines
4. send those headlines to the right side
5. keep the full story available for the center screen


HOW TO MAKE MAJOR CHANGES:

VISIBLE SCREEN / LAYOUT:

    MMM-MirrorController.js
    MMM-MirrorController.css


PRIVATE DATA / AI / INTERNET:

    node_helper.js


IMPORTANT:

NEVER hard-code an OpenAI API key into this file.

Even though this is the backend, the repository is public.

The actual key belongs only on the Raspberry Pi.

===============================================================================
*/
