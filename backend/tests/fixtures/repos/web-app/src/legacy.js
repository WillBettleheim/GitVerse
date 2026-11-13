const lazy = require("./lazy");
const name = "./" + "dynamic";
const notStatic = require(name);
module.exports = { lazy, notStatic };
exports.extra = 1;
