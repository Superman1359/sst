import * as cdk from "@aws-cdk/core";
import * as cxapi from "@aws-cdk/cx-api";

/**
 * Deploy props for apps.
 */
export interface DeployProps {
  /**
   * The app name, used to prefix stacks.
   *
   * @default - Defaults to empty string
   */
  readonly name?: string;

  /**
   * The stage to deploy this app to.
   *
   * @default - Defaults to dev
   */
  readonly stage?: string;

  /**
   * The region to deploy this app to.
   *
   * @default - Defaults to us-east-1
   */
  readonly region?: string;
}

/**
 * Local build props for apps.
 */
export interface BuildProps {
  /**
   * The root path for the SST app.
   */
  readonly appPath: string;

  /**
   * The local WebSockets debug enpoint used by `sst start`.
   *
   * @default - Defaults to undefined
   */
  readonly debugEndpoint?: string;
}

export type AppProps = cdk.AppProps;

export class App extends cdk.App {
  /**
   * Is the app being deployed locally
   */
  public readonly local: boolean = false;

  /**
   * The app name
   */
  public readonly name: string;

  /**
   * The stage to deploy to
   */
  public readonly stage: string;

  /**
   * The region to deploy to
   */
  public readonly region: string;

  /**
   * The root path for the SST app
   */
  public readonly appPath: string;

  /**
   * The build dir for the SST app
   */
  public readonly buildDir: string = ".build";

  /**
   * The local WebSockets debug endpoint
   */
  public readonly debugEndpoint?: string;

  constructor(
    deployProps: DeployProps = {},
    buildProps: BuildProps,
    props: AppProps = {}
  ) {
    super(props);

    this.stage = deployProps.stage || "dev";
    this.name = deployProps.name || "my-app";
    this.region = deployProps.region || "us-east-1";

    this.appPath = buildProps.appPath;

    if (buildProps.debugEndpoint) {
      this.local = true;
      this.debugEndpoint = buildProps.debugEndpoint;
    }
  }

  logicalPrefixedName(logicalName: string): string {
    const namePrefix = this.name === "" ? "" : `${this.name}-`;
    return `${this.stage}-${namePrefix}${logicalName}`;
  }

  synth(options: cdk.StageSynthesisOptions = {}): cxapi.CloudAssembly {
    for (const child of this.node.children) {
      if (
        child instanceof cdk.Stack &&
        child.stackName.indexOf(`${this.stage}-`) !== 0
      ) {
        throw new Error(
          `Stack (${child.stackName}) is not prefixed with the stage. Use sst.Stack or the format {stageName}-${child.stackName}.`
        );
      }
    }
    return super.synth(options);
  }
}
