const express = require("express");
const chalk = require("chalk");
const morgan = require("morgan");

const cfsolver = require("./api/cfsolver");
const hcaptchasolver = require("./api/hcaptchasolver");

const app = express();
const port = process.env.PORT || 9898;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set("json spaces", 2);
app.use(morgan("dev"));

app.use("/cfsolver", cfsolver);
app.use("/hcaptchasolver", hcaptchasolver);
app.use("/hcaptcha", hcaptchasolver);
app.use("/", hcaptchasolver);

app.listen(port, () => {
  console.clear();
  const line = chalk.gray("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  const title = chalk.bold.greenBright("SERVER STARTED SUCCESSFULLY");
  const info = [
    `${chalk.bold.cyan("Port")}   : ${chalk.bold.white(port)}`,
    `${chalk.bold.cyan("Local")}  : ${chalk.bold.white(`http://localhost:${port}`)}`,
    `${chalk.bold.cyan("Public")} : ${
      process.env.DOMAIN
        ? chalk.bold.white(`https://${process.env.DOMAIN}`)
        : chalk.bold.gray("-")
    }`
  ].join("\n");

  console.log(`\n${line}\n${title}\n\n${info}\n${line}\n`);
});
