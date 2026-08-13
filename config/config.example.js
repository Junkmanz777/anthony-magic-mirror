let config = {
  address: "localhost",
  port: 8080,

  basePath: "/",

  ipWhitelist: [
    "127.0.0.1",
    "::ffff:127.0.0.1",
    "::1",
  ],

  useHttps: false,

  language: "en",
  locale: "en-US",

  timeFormat: 12,
  units: "imperial",

  modules: [
    {
      module: "clock",
      position: "top_left",
    },

    {
      module: "weather",
      position: "top_right",
      config: {
        weatherProvider: "openmeteo",
        type: "current",

        // Clovis, New Mexico
        lat: 34.4048,
        lon: -103.2052,
      },
    },

    {
      module: "weather",
      position: "top_right",
      header: "Forecast",
      config: {
        weatherProvider: "openmeteo",
        type: "forecast",

        lat: 34.4048,
        lon: -103.2052,

        maxNumberOfDays: 5,
      },
    },

    {
      module: "calendar",
      position: "top_left",
      header: "Calendar",
      config: {
        calendars: [],
      },
    },
  ],
};

/*************** DO NOT EDIT BELOW ***************/

if (typeof module !== "undefined") {
  module.exports = config;
}
