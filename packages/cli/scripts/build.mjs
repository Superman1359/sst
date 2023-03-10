"use strict";

import chalk from "chalk";
import { logger, Bootstrap } from "@serverless-stack/core";

import { synth, validatePropsForJs } from "./util/cdkHelpers.mjs";

export default async function (argv, config, cliInfo) {
  logger.info(chalk.grey("Synthesizing CDK"));

  // Deploy bootstrap stack
  await Bootstrap.bootstrap(config, cliInfo);

  const { stacks } = await synth(cliInfo.cdkOptions);
  validatePropsForJs(config);
  printStacks(stacks, cliInfo.yarn);
}

function printStacks(stacks, usingYarn) {
  const l = stacks.length;
  const stacksCopy = l === 1 ? "stack" : "stacks";
  const deployCmd = usingYarn ? "yarn sst deploy" : "npx sst deploy";

  logger.info(
    `\nSuccessfully compiled ${l} ${stacksCopy} to ${chalk.cyan(
      ".build/cdk.out"
    )}:\n`
  );

  for (var i = 0; i < l; i++) {
    const stack = stacks[i];
    logger.info(`  ${chalk.cyan(stack.name)}`);
  }

  logger.info(`\nRun ${chalk.cyan(deployCmd)} to deploy to AWS.`);
}