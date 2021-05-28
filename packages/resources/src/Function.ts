/* eslint-disable @typescript-eslint/ban-types*/
// Note: disabling ban-type rule so we don't get an error referencing the class Function

import path from "path";
import * as esbuild from "esbuild";
import * as cdk from "@aws-cdk/core";
import * as iam from "@aws-cdk/aws-iam";
import * as lambda from "@aws-cdk/aws-lambda";

import { App } from "./App";
import { Stack } from "./Stack";
import { builder as goBuilder } from "./util/goBuilder";
import { builder as nodeBuilder } from "./util/nodeBuilder";
import { builder as pythonBuilder } from "./util/pythonBuilder";
import {
  PermissionType,
  Permissions,
  attachPermissionsToRole,
} from "./util/permission";

const supportedRuntimes = [
  lambda.Runtime.NODEJS,
  lambda.Runtime.NODEJS_4_3,
  lambda.Runtime.NODEJS_6_10,
  lambda.Runtime.NODEJS_8_10,
  lambda.Runtime.NODEJS_10_X,
  lambda.Runtime.NODEJS_12_X,
  lambda.Runtime.NODEJS_14_X,
  lambda.Runtime.PYTHON_2_7,
  lambda.Runtime.PYTHON_3_6,
  lambda.Runtime.PYTHON_3_7,
  lambda.Runtime.PYTHON_3_8,
  lambda.Runtime.GO_1_X,
];

export type HandlerProps = FunctionHandlerProps;
export type FunctionDefinition = string | Function | FunctionProps;

export interface FunctionProps
  extends Omit<lambda.FunctionOptions, "timeout" | "runtime"> {
  /**
   * Path to the entry point and handler function. Of the format:
   * `/path/to/file.function`.
   */
  readonly handler?: string;
  /**
   * The source directory where the entry point is located. The node_modules in this
   * directory is used to generate the bundle.
   *
   * @default - Defaults to the app directory.
   */
  readonly srcPath?: string;
  /**
   * The runtime environment.
   *
   * @default - Defaults to NODEJS_12_X
   */
  readonly runtime?: string | lambda.Runtime;
  /**
   * The amount of memory in MB allocated.
   *
   * @default - Defaults to 1024
   */
  readonly memorySize?: number;
  /**
   * The execution timeout in seconds.
   *
   * @default - number
   */
  readonly timeout?: number | cdk.Duration;
  /**
   * Enable AWS X-Ray Tracing.
   *
   * @default - Defaults to ACTIVE
   */
  readonly tracing?: lambda.Tracing;
  /**
   * Disable bundling with esbuild.
   *
   * @default - Defaults to true
   */
  readonly bundle?: boolean | FunctionBundleProps;
  readonly permissions?: Permissions;
}

export interface FunctionHandlerProps {
  readonly srcPath: string;
  readonly handler: string;
  readonly bundle: boolean | FunctionBundleProps;
  readonly runtime: string;
}

export interface FunctionBundleProps {
  readonly loader?: { [ext: string]: esbuild.Loader };
  readonly externalModules?: string[];
  readonly nodeModules?: string[];
  readonly copyFiles?: FunctionBundleCopyFilesProps[];
}

export interface FunctionBundleCopyFilesProps {
  readonly from: string;
  readonly to: string;
}

export class Function extends lambda.Function {
  constructor(scope: cdk.Construct, id: string, props: FunctionProps) {
    const root = scope.node.root as App;

    // Merge with app defaultFunctionProps
    // note: reverse order so later prop override earlier ones
    root.defaultFunctionProps.reverse().forEach((per) => {
      props =
        typeof per === "function"
          ? Function.mergeProps(per(Stack.of(scope)), props)
          : Function.mergeProps(per, props);
    });

    // Set defaults
    const handler = props.handler;
    let timeout = props.timeout || 10;
    const srcPath = props.srcPath || ".";
    const memorySize = props.memorySize || 1024;
    const tracing = props.tracing || lambda.Tracing.ACTIVE;
    let runtime = props.runtime || lambda.Runtime.NODEJS_12_X;
    const bundle = props.bundle === undefined ? true : props.bundle;
    const permissions = props.permissions;

    // Validate handler
    if (!handler) {
      throw new Error(`No handler defined for the "${id}" Lambda function`);
    }

    // Normalize runtime
    const runtimeStr =
      typeof runtime === "string" ? runtime : runtime.toString();
    const runtimeClass = supportedRuntimes.find(
      (per) => per.toString() === runtimeStr
    );
    if (!runtimeClass) {
      throw new Error(
        `The specified runtime is not supported for sst.Function. Only NodeJS, Python, and Go runtimes are currently supported.`
      );
    }
    runtime = runtimeClass;

    // Normalize timeout
    if (typeof timeout === "number") {
      timeout = cdk.Duration.seconds(timeout);
    }

    // Validate input
    const isNodeRuntime = runtimeStr.startsWith("nodejs");
    const isGoRuntime = runtimeStr.startsWith("go");
    const isPythonRuntime = runtimeStr.startsWith("python");
    if (isNodeRuntime) {
      if (!bundle && srcPath === ".") {
        throw new Error(
          `Bundle cannot be disabled for the "${id}" function since the "srcPath" is set to the project root. Read more here — https://github.com/serverless-stack/serverless-stack/issues/78`
        );
      }
    } else if (isPythonRuntime) {
      if (srcPath === ".") {
        throw new Error(
          `Cannot set the "srcPath" to the project root for the "${id}" function.`
        );
      }
    }

    // Handle local development (ie. sst start)
    // - set runtime to nodejs12.x for non-Node runtimes (b/c the stub is in Node)
    // - set retry to 0. When the debugger is disconnected, the Cron construct
    //   will still try to periodically invoke the Lambda, and the requests would
    //   fail and retry. So when launching `sst start`, a couple of retry requests
    //   from recent failed request will be received. And this behavior is confusing.
    // - set timeout to 900. This will give people more time to debug the function
    //   without timing out the request. Note API Gateway requests have a maximum
    //   timeout of 29s. In this case, the API will timeout, but the Lambda function
    //   will continue to run.
    if (
      root.local &&
      root.debugEndpoint &&
      root.debugBucketName &&
      root.debugBucketArn
    ) {
      super(scope, id, {
        ...props,
        runtime: isNodeRuntime ? runtime : lambda.Runtime.NODEJS_12_X,
        tracing,
        memorySize,
        handler: "index.main",
        timeout: cdk.Duration.seconds(900),
        retryAttempts: 0,
        code: lambda.Code.fromAsset(
          path.resolve(__dirname, "../dist/stub.zip")
        ),
        environment: {
          ...(props.environment || {}),
          SST_DEBUG_SRC_PATH: srcPath,
          SST_DEBUG_SRC_HANDLER: handler,
          SST_DEBUG_ENDPOINT: root.debugEndpoint,
          SST_DEBUG_BUCKET_NAME: root.debugBucketName,
        },
      });
      this.attachPermissions([
        new iam.PolicyStatement({
          actions: ["s3:*"],
          effect: iam.Effect.ALLOW,
          resources: [root.debugBucketArn, `${root.debugBucketArn}/*`],
        }),
      ]);
    }
    // Handle remove (ie. sst remove)
    else if (root.skipBuild) {
      // Note: need to override runtime as CDK does not support inline code
      //       for some runtimes.
      super(scope, id, {
        ...props,
        runtime: lambda.Runtime.NODEJS_12_X,
        handler: "placeholder",
        code: new lambda.InlineCode("placeholder"),
        timeout,
      });
    }
    // Handle build
    else {
      let outCode, outHandler;
      if (isGoRuntime) {
        const ret = goBuilder({
          srcPath,
          handler,
          buildDir: root.buildDir,
        });
        outCode = ret.outCode;
        outHandler = ret.outHandler;
      } else if (isPythonRuntime) {
        const ret = pythonBuilder({
          runtime,
          srcPath,
          handler,
        });
        outCode = ret.outCode;
        outHandler = ret.outHandler;
      } else {
        const ret = nodeBuilder({
          bundle,
          srcPath,
          handler,
          runtime,
          buildDir: root.buildDir,
        });
        outCode = ret.outCode;
        outHandler = ret.outHandler;
      }
      super(scope, id, {
        ...props,
        runtime,
        tracing,
        memorySize,
        handler: outHandler,
        code: outCode,
        timeout,
      });
    }

    // Enable reusing connections with Keep-Alive for NodeJs Lambda function
    if (isNodeRuntime) {
      this.addEnvironment("AWS_NODEJS_CONNECTION_REUSE_ENABLED", "1", {
        removeInEdge: true,
      });
    }

    // Attach permissions
    if (permissions) {
      this.attachPermissions(permissions);
    }

    // register Lambda function in app
    root.registerLambdaHandler({
      srcPath,
      handler,
      bundle,
      runtime: runtimeStr,
    } as FunctionHandlerProps);
  }

  attachPermissions(permissions: Permissions): void {
    if (this.role) {
      attachPermissionsToRole(this.role as iam.Role, permissions);
    }
  }

  static fromDefinition(
    scope: cdk.Construct,
    id: string,
    definition: FunctionDefinition,
    inheritedProps?: FunctionProps,
    inheritErrorMessage?: string
  ): Function {
    if (typeof definition === "string") {
      return new Function(scope, id, {
        ...(inheritedProps || {}),
        handler: definition,
      });
    } else if (definition instanceof Function) {
      if (inheritedProps && Object.keys(inheritedProps).length > 0) {
        throw new Error(
          inheritErrorMessage ||
            `Cannot inherit default props when a Function is provided`
        );
      }
      return definition;
    } else if (definition instanceof lambda.Function) {
      throw new Error(
        `Please use sst.Function instead of lambda.Function for the "${id}" Function.`
      );
    } else if ((definition as FunctionProps).handler !== undefined) {
      return new Function(
        scope,
        id,
        Function.mergeProps(inheritedProps, definition)
      );
    }
    throw new Error(`Invalid function definition for the "${id}" Function`);
  }

  static mergeProps(
    baseProps?: FunctionProps,
    props?: FunctionProps
  ): FunctionProps {
    // Merge environment
    const environment = {
      ...(baseProps?.environment || {}),
      ...(props?.environment || {}),
    };
    const environmentProp =
      Object.keys(environment).length === 0 ? {} : { environment };

    // Merge permissions
    let permissionsProp;
    if (
      baseProps?.permissions === PermissionType.ALL ||
      props?.permissions === PermissionType.ALL
    ) {
      permissionsProp = { permissions: PermissionType.ALL };
    } else {
      const permissions = (baseProps?.permissions || []).concat(
        props?.permissions || []
      );
      permissionsProp = permissions.length === 0 ? {} : { permissions };
    }

    return {
      ...(baseProps || {}),
      ...(props || {}),
      ...environmentProp,
      ...permissionsProp,
    };
  }
}
