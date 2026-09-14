/**
 * Side-effect barrel: importing this module registers every built-in harness
 * driver. Any entry point that resolves drivers (invoke, probe, console
 * harness health) imports this once instead of maintaining its own list.
 */
import "./opencodeDriver.js";
import "./codexDriver.js";
import "./copilotDriver.js";
import "./claudeDriver.js";
import "./hermesDriver.js";
import "./piDriver.js";
