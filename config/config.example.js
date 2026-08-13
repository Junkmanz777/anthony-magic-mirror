let config = {
  address: "localhost",

  port: 8080,

  basePath: "/",

  ipWhitelist: [
    "127.0.0.1",
    "::ffff:127.0.0.1",
    "::1"
  ],

  useHttps: false,

  language: "en",

  locale: "en-US",

  timeFormat: 12,

  units: "imperial",


  /*
   * MAGICMIRROR MODULES
   *
   * For now our custom controller owns the whole display.
   */

  modules: [
    {
      module: "MMM-MirrorController",

      /*
       * MagicMirror normally expects modules to live
       * in regions like top_left or bottom_right.
       *
       * Our controller uses CSS to control the entire
       * screen, so "fullscreen_above" is our container.
       */

      position: "fullscreen_above",

      config: {
        mirrorName: "HAL"
      }
    }
  ]
};


/*
 * MagicMirror requires this.
 */

if (typeof module !== "undefined") {
  module.exports = config;
}


/*
===============================================================================
NOTES TO A NEWBIE PROGRAMMER
===============================================================================

WHAT THIS FILE DOES:

This tells MagicMirror which modules it should load.

Right now we are loading only:

    MMM-MirrorController


WHY DID WE REMOVE THE NORMAL CLOCK AND WEATHER MODULES?

Originally this file loaded:

- clock
- weather
- forecast
- calendar

But our custom mirror controller now owns the entire screen.

It already has places for:

- time
- temperature
- rain chance
- date
- Daily Buzz
- center information
- AI captions

If we loaded both systems at the same time,
they would overlap each other.


WHAT DOES THIS MEAN?

    module: "MMM-MirrorController"

This tells MagicMirror:

"Load the folder named MMM-MirrorController."


WHAT DOES THIS MEAN?

    position: "fullscreen_above"

MagicMirror normally divides the screen into areas.

Examples:

    top_left
    top_right
    bottom_center

Our controller needs access to the whole screen,
so we put it in:

    fullscreen_above


WHY IS mirrorName STILL HERE?

    mirrorName: "HAL"

This is only the DEFAULT.

After first-boot setup, the name stored on the
Raspberry Pi can replace it.


HOW TO ADD ANOTHER MAGICMIRROR MODULE LATER:

Add another object inside:

    modules: [

For example:

    {
      module: "SomeOtherModule",
      position: "top_left"
    }

But we probably won't need many normal MagicMirror modules.

Our goal is for MMM-MirrorController to become the
main operating system for the display.


IMPORTANT:

Do not put:

- OpenAI API keys
- passwords
- private calendar URLs
- other secrets

inside this file.

This file is stored in the public GitHub repository.

===============================================================================
*/
