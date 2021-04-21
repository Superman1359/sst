#!/usr/bin/env node

"use strict";

process.on("uncaughtException", (err) => {
  // Format any uncaught exceptions
  console.error("\n" + (err ? err.stack || err : "Uncaught exception") + "\n");
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  throw err;
});

require("source-map-support").install();

const path = require("path");
const fs = require("fs-extra");
const yargs = require("yargs");
const chalk = require("chalk");
const dotenv = require("dotenv");
const dotenvExpand = require("dotenv-expand");
const spawn = require("cross-spawn");
const { logger, initializeLogger } = require("@serverless-stack/core");

const packageJson = require("../package.json");
const paths = require("../scripts/util/paths");
const cdkOptions = require("../scripts/util/cdkOptions");
const { getCdkVersion } = require("@serverless-stack/core");
const { prepareCdk } = require("../scripts/util/cdkHelpers");
const { exitWithMessage } = require("../scripts/util/processHelpers");

const sstVersion = packageJson.version;
const cdkVersion = getCdkVersion();

const args = process.argv.slice(2);

const script = args[0];
const scriptArgs = args.slice(1);

const cmd = {
  s: "sst",
  cdk: "cdk",
  test: "test",
  start: "start",
  build: "build",
  deploy: "deploy",
  remove: "remove",
  addCdk: "add-cdk",
};

const internals = {
  [cmd.start]: require("../scripts/start"),
  [cmd.build]: require("../scripts/build"),
  [cmd.deploy]: require("../scripts/deploy"),
  [cmd.remove]: require("../scripts/remove"),
  [cmd.addCdk]: require("../scripts/add-cdk"),
};

const DEFAULT_STAGE = "dev";
const DEFAULT_NAME = "my-app";
const DEFAULT_REGION = "us-east-1";
const DEFAULT_LINT = true;
const DEFAULT_TYPE_CHECK = true;

function getCliInfo() {
  const usingYarn = fs.existsSync(path.join(paths.appPath, "yarn.lock"));

  return {
    cdkVersion,
    yarn: usingYarn,
    npm: !usingYarn,
    // Options that'll be passed into CDK
    cdkOptions: {
      ...cdkOptions,
      verbose: argv.verbose ? 2 : 0,
      noColor: process.env.NO_COLOR === "true",
    },
  };
}

function addOptions(currentCmd) {
  return function (yargs) {
    yargs
      .option("stage", {
        type: "string",
        describe: "The stage you want to deploy to",
      })
      .option("region", {
        type: "string",
        describe: "The region you want to deploy to",
      });

    if (currentCmd === cmd.deploy || currentCmd === cmd.remove) {
      yargs.positional("stack", {
        type: "string",
        describe: "Specify a stack, if you have multiple stacks",
      });
    }

    if (currentCmd === cmd.deploy || currentCmd === cmd.start) {
      yargs.option("outputs-file", {
        type: "string",
        describe: "Path to file where the stack outputs will be written",
      });
    }

    if (currentCmd === cmd.start) {
      yargs.option("port", {
        type: "number",
        describe:
          "Configure the port for local Lambda Runtime API server. Default is 12577.",
        default: 12577,
      });
    }
  };
}

function applyConfig(argv) {
  const configPath = path.join(paths.appPath, "sst.json");

  if (!(fs.existsSync(configPath))) {
    exitWithMessage(
      `\nAdd the ${chalk.bold(
        "sst.json"
      )} config file in your project root to get started. Or use the ${chalk.bold(
        "create-serverless-stack"
      )} CLI to create a new project.\n`
    );
  }

  let config;

  try {
    config = fs.readJsonSync(configPath);
  } catch (e) {
    exitWithMessage(
      `\nThere was a problem reading the ${chalk.bold(
        "sst.json"
      )} config file. Make sure it is in valid JSON format.\n`
    );
  }

  if (!config.name || config.name.trim() === "") {
    exitWithMessage(
      `\nGive your Serverless Stack app a ${chalk.bold(
        "name"
      )} in the ${chalk.bold("sst.json")}.\n\n  "name": "my-sst-app"\n`
    );
  }

  config.name = config.name || DEFAULT_NAME;
  config.stage = argv.stage || config.stage || DEFAULT_STAGE;
  config.lint = config.lint === false ? false : DEFAULT_LINT;
  config.region = argv.region || config.region || DEFAULT_REGION;
  config.typeCheck = config.typeCheck === false ? false : DEFAULT_TYPE_CHECK;

  return config;
}

function loadDotenv(stage) {
  [`.env.${stage}.local`, `.env.${stage}`, `.env.local`, `.env`]
    .map(file => path.join(paths.appPath, file))
    .filter(path => fs.existsSync(path))
    .map(path => dotenvExpand(dotenv.config({ path, debug: process.env.DEBUG })));
}

/**
 * If `npm run` is used to execute these commands, you need to add `--` before
 * the options. If it's not used, the command will run but the options will not be
 * set correctly. The region or the stage might get set as the stack. This
 * function simply checks if the stack is set to a common stage name or a region.
 * And shows a warning.
 */
function checkNpmScriptArgs() {
  const commonStageAndRegions = [
    "qa",
    "dev",
    "prod",
    "stage",
    "staging",
    "preprod",
    "production",
    "development",
    "eu-west-1",
    "eu-west-2",
    "sa-east-1",
    "us-east-1",
    "us-east-2",
    "us-west-1",
    "us-west-2",
    "ap-south-1",
    "ca-central-1",
    "eu-central-1",
    "ap-northeast-2",
    "ap-southeast-1",
    "ap-southeast-2",
    "ap-northeast-1",
  ];

  if (commonStageAndRegions.indexOf(argv.stack) !== -1) {
    logger.warn(
      chalk.yellow(
        `\nWarning: It looks like you might be setting the stack option to "${argv.stack}" by mistake. If you are using "npm run", make sure to add "--" before the options. For example, "npm run deploy -- --stage prod".\n`
      )
    );
  }
}

const argv = yargs
  .parserConfiguration({ "boolean-negation": false })

  .usage(`${cmd.s} <command>`)
  .demandCommand(1)

  .option("no-color", {
    default: false,
    type: "boolean",
    desc: "Remove colors and other style from console output",
  })
  .option("verbose", {
    default: false,
    type: "boolean",
    desc: "Show more debug info in the output",
  })

  .command(
    cmd.build,
    "Build your app and synthesize your stacks",
    addOptions(cmd.build)
  )
  .command(
    `${cmd.deploy} [stack]`,
    "Deploy all your stacks to AWS",
    addOptions(cmd.deploy)
  )
  .command(
    `${cmd.remove} [stack]`,
    "Remove all your stacks and all of their resources from AWS",
    addOptions(cmd.remove)
  )
  .command(
    `${cmd.addCdk} [packages..]`,
    "Installs the given CDK package(s) in your app",
    {
      dev: {
        default: false,
        type: "boolean",
        desc: "Install as a dev dependency",
      },
      "dry-run": {
        default: false,
        type: "boolean",
        desc: "Do not install, but show the install command",
      },
    }
  )

  .command(cmd.test, "Run your tests")
  .command(cmd.cdk, "Access the forked AWS CDK CLI")
  .command(cmd.start, "Work on your SST app locally", addOptions(cmd.start))

  .example([
    [`$0 ${cmd.build}`, "Build using defaults"],
    [`$0 ${cmd.remove} my-s3-stack`, "Remove a specific stack"],
    [
      `$0 ${cmd.deploy} --stage prod --region us-west-1`,
      "Deploy to a stage and region",
    ],
  ])

  .version(
    true,
    "Show the version of SST and CDK",
    `SST: ${sstVersion}\nCDK: ${cdkVersion}`
  )
  .alias("version", "v")
  .help("help")
  .alias("help", "h")
  .epilogue("For more information, visit www.serverless-stack.com")

  .wrap(yargs.terminalWidth())

  .fail((msg, err) => {
    if (err) throw err;

    console.log(chalk.red(msg) + "\n");

    yargs.showHelp();

    process.exit(1);
  })
  .parse();

// Disable color
if (!process.stdout.isTTY || argv.noColor) {
  process.env.NO_COLOR = "true";
  chalk.level = 0;
}

// Set debug flag
if (argv.verbose) {
  process.env.DEBUG = "true";
}

// Parse cli input and load config
const cliInfo = getCliInfo();
const config = applyConfig(argv);

// Cache process env without dotenv, b/c we don't want to apply these
// envs when spawning the Lambda function process
config.localEnv = { ...process.env };
loadDotenv(config.stage);

// Empty and recreate the .build directory
fs.emptyDirSync(paths.appBuildPath);

// Initialize logger after .build diretory is created, in which the debug log will be written
initializeLogger(paths.appBuildPath);
logger.debug("SST:", sstVersion);
logger.debug("CDK:", cdkVersion);

switch (script) {
  case cmd.build:
  case cmd.deploy:
  case cmd.remove: {
    if (cliInfo.npm) {
      checkNpmScriptArgs();
    }

    // Prepare app
    prepareCdk(argv, cliInfo, config).then(() =>
      internals[script](argv, config, cliInfo)
    );

    break;
  }
  case cmd.start:
  case cmd.addCdk: {
    Promise.resolve(internals[script](argv, config, cliInfo));
    break;
  }
  case cmd.cdk:
  case cmd.test: {
    // Prepare app
    prepareCdk(argv, cliInfo, config).then(() => {
      const result = spawn.sync(
        "node",
        [require.resolve("../scripts/" + script)].concat(scriptArgs),
        { stdio: "inherit" }
      );
      if (result.signal) {
        if (result.signal === "SIGKILL") {
          console.log(
            "The command failed because the process exited too early. " +
              "This probably means the system ran out of memory or someone called " +
              "`kill -9` on the process."
          );
        } else if (result.signal === "SIGTERM") {
          console.log(
            "The command failed because the process exited too early. " +
              "Someone might have called `kill` or `killall`, or the system could " +
              "be shutting down."
          );
        }
        process.exit(1);
      }
      process.exit(result.status);
    });
    break;
  }
  default:
    console.log('Unknown script "' + script + '".');
    break;
}
