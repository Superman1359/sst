import * as cdk from "@aws-cdk/core";
import * as rds from "@aws-cdk/aws-rds";
import * as appsync from "@aws-cdk/aws-appsync";
import * as dynamodb from "@aws-cdk/aws-dynamodb";
import * as secretsmanager from "@aws-cdk/aws-secretsmanager";

import { App } from "./App";
import { Table } from "./Table";
import { Function as Fn, FunctionProps, FunctionDefinition } from "./Function";
import { Permissions } from "./util/permission";

/////////////////////
// Interfaces
/////////////////////

export interface AppSyncApiProps {
  readonly graphqlApi?: appsync.IGraphqlApi | AppSyncApiCdkGraphApiProps;
  readonly dataSources?: {
    [key: string]:
      | FunctionDefinition
      | AppSyncApiLambdaDataSourceProps
      | AppSyncApiDynamoDbDataSourceProps
      | AppSyncApiRdsDataSourceProps
      | AppSyncApiHttpDataSourceProps;
  };
  readonly resolvers?: {
    [key: string]: string | FunctionDefinition | AppSyncApiResolverProps;
  };
  readonly defaultFunctionProps?: FunctionProps;
}

export interface AppSyncApiLambdaDataSourceProps {
  readonly function: FunctionDefinition;
  readonly options?: appsync.DataSourceOptions;
}

export interface AppSyncApiDynamoDbDataSourceProps {
  readonly table: Table | dynamodb.Table;
  readonly options?: appsync.DataSourceOptions;
}

export interface AppSyncApiRdsDataSourceProps {
  readonly serverlessCluster: rds.IServerlessCluster;
  readonly secretStore: secretsmanager.ISecret;
  readonly databaseName?: string;
  readonly options?: appsync.DataSourceOptions;
}

export interface AppSyncApiHttpDataSourceProps {
  readonly endpoint: string;
  readonly options?: appsync.HttpDataSourceOptions;
}

export interface AppSyncApiResolverProps {
  readonly dataSource?: string;
  readonly function?: FunctionDefinition;
  readonly resolverProps?: AppSyncApiCdkResolverProps;
}

export interface AppSyncApiCdkGraphApiProps
  extends Omit<appsync.GraphqlApiProps, "name"> {
  readonly name?: string;
}

export type AppSyncApiCdkResolverProps = Omit<
  appsync.BaseResolverProps,
  "fieldName" | "typeName"
>;

/////////////////////
// Construct
/////////////////////

export class AppSyncApi extends cdk.Construct {
  public readonly graphqlApi: appsync.IGraphqlApi;
  private readonly functionsByDsKey: { [key: string]: Fn };
  private readonly functionsByResKey: { [key: string]: Fn };
  private readonly dataSourcesByDsKey: {
    [key: string]: appsync.BaseDataSource;
  };
  private readonly dataSourcesByResKey: {
    [key: string]: appsync.BaseDataSource;
  };
  private readonly permissionsAttachedForAllFunctions: Permissions[];
  private readonly defaultFunctionProps?: FunctionProps;

  constructor(scope: cdk.Construct, id: string, props?: AppSyncApiProps) {
    super(scope, id);

    const root = scope.node.root as App;
    const { graphqlApi, dataSources, resolvers, defaultFunctionProps } =
      props || {};
    this.functionsByDsKey = {};
    this.functionsByResKey = {};
    this.dataSourcesByDsKey = {};
    this.dataSourcesByResKey = {};
    this.permissionsAttachedForAllFunctions = [];
    this.defaultFunctionProps = defaultFunctionProps;

    ////////////////////
    // Create Api
    ////////////////////

    if (cdk.Construct.isConstruct(graphqlApi)) {
      this.graphqlApi = graphqlApi as appsync.GraphqlApi;
    } else {
      const graphqlApiProps = (graphqlApi || {}) as AppSyncApiCdkGraphApiProps;
      this.graphqlApi = new appsync.GraphqlApi(this, "Api", {
        name: root.logicalPrefixedName(id),
        xrayEnabled: true,
        ...graphqlApiProps,
      });
    }

    ///////////////////////////
    // Configure data sources
    ///////////////////////////

    if (dataSources) {
      Object.keys(dataSources).forEach((key: string) =>
        this.addDataSource(this, key, dataSources[key])
      );
    }

    ///////////////////////////
    // Configure resolvers
    ///////////////////////////

    if (resolvers) {
      Object.keys(resolvers).forEach((key: string) =>
        this.addResolver(this, key, resolvers[key])
      );
    }
  }

  public addDataSources(
    scope: cdk.Construct,
    dataSources: {
      [key: string]:
        | FunctionDefinition
        | AppSyncApiLambdaDataSourceProps
        | AppSyncApiDynamoDbDataSourceProps
        | AppSyncApiRdsDataSourceProps
        | AppSyncApiHttpDataSourceProps;
    }
  ): void {
    Object.keys(dataSources).forEach((key: string) => {
      // add data source
      const fn = this.addDataSource(scope, key, dataSources[key]);

      // attached existing permissions
      if (fn) {
        this.permissionsAttachedForAllFunctions.forEach((permissions) =>
          fn.attachPermissions(permissions)
        );
      }
    });
  }

  public addResolvers(
    scope: cdk.Construct,
    resolvers: {
      [key: string]: FunctionDefinition | AppSyncApiResolverProps;
    }
  ): void {
    Object.keys(resolvers).forEach((key: string) => {
      // add resolver
      const fn = this.addResolver(scope, key, resolvers[key]);

      // attached existing permissions
      if (fn) {
        this.permissionsAttachedForAllFunctions.forEach((permissions) =>
          fn.attachPermissions(permissions)
        );
      }
    });
  }

  private addDataSource(
    scope: cdk.Construct,
    dsKey: string,
    dsValue:
      | FunctionDefinition
      | AppSyncApiLambdaDataSourceProps
      | AppSyncApiDynamoDbDataSourceProps
      | AppSyncApiRdsDataSourceProps
      | AppSyncApiHttpDataSourceProps
  ): Fn | undefined {
    let dataSource;
    let lambda;

    // Lambda ds
    if ((dsValue as AppSyncApiLambdaDataSourceProps).function) {
      dsValue = dsValue as AppSyncApiLambdaDataSourceProps;
      lambda = Fn.fromDefinition(
        scope,
        `Lambda_${dsKey}`,
        dsValue.function,
        this.defaultFunctionProps
      );
      dataSource = this.graphqlApi.addLambdaDataSource(
        dsKey,
        lambda,
        dsValue.options
      );
    }
    // DynamoDb ds
    else if ((dsValue as AppSyncApiDynamoDbDataSourceProps).table) {
      dsValue = dsValue as AppSyncApiDynamoDbDataSourceProps;
      const table =
        dsValue.table instanceof Table
          ? dsValue.table.dynamodbTable
          : dsValue.table;
      dataSource = this.graphqlApi.addDynamoDbDataSource(
        dsKey,
        table,
        dsValue.options
      );
    }
    // Rds ds
    else if ((dsValue as AppSyncApiRdsDataSourceProps).serverlessCluster) {
      dsValue = dsValue as AppSyncApiRdsDataSourceProps;
      dataSource = this.graphqlApi.addRdsDataSource(
        dsKey,
        dsValue.serverlessCluster,
        dsValue.secretStore,
        dsValue.databaseName,
        dsValue.options
      );
    }
    // Http ds
    else if ((dsValue as AppSyncApiHttpDataSourceProps).endpoint) {
      dsValue = dsValue as AppSyncApiHttpDataSourceProps;
      dataSource = this.graphqlApi.addHttpDataSource(
        dsKey,
        dsValue.endpoint,
        dsValue.options
      );
    }
    // Lambda function
    else {
      dsValue = dsValue as FunctionDefinition;
      lambda = Fn.fromDefinition(
        scope,
        `Lambda_${dsKey}`,
        dsValue,
        this.defaultFunctionProps
      );
      dataSource = this.graphqlApi.addLambdaDataSource(dsKey, lambda);
    }
    this.dataSourcesByDsKey[dsKey] = dataSource;
    if (lambda) {
      this.functionsByDsKey[dsKey] = lambda;
    }

    return lambda;
  }

  private addResolver(
    scope: cdk.Construct,
    resKey: string,
    resValue: FunctionDefinition | AppSyncApiResolverProps
  ): Fn | undefined {
    let lambda;
    let dataSource;
    let resolverProps;

    // Normalize resKey
    resKey = this.normalizeResolverKey(resKey);

    // Get type and field
    const resolverKeyParts = resKey.split(" ");
    if (resolverKeyParts.length !== 2) {
      throw new Error(`Invalid resolver ${resKey}`);
    }
    const [typeName, fieldName] = resolverKeyParts;
    if (fieldName.length === 0) {
      throw new Error(`Invalid field defined for "${resKey}"`);
    }

    ///////////////////
    // Create data source if not created before
    ///////////////////
    // DataSource key
    if (
      typeof resValue === "string" &&
      Object.keys(this.dataSourcesByDsKey).includes(resValue)
    ) {
      dataSource = this.dataSourcesByDsKey[resValue];
      resolverProps = {};
    }
    // DataSource key not exist (string does not have a dot, assume it is referencing a data store)
    else if (typeof resValue === "string" && resValue.indexOf(".") === -1) {
      throw new Error(
        `Failed to create resolver "${resKey}". Data source "${resValue}" does not exist.`
      );
    }
    // Lambda resolver
    else if (this.isLambdaResolverProps(resValue as AppSyncApiResolverProps)) {
      resValue = resValue as AppSyncApiResolverProps;
      lambda = Fn.fromDefinition(
        scope,
        `Lambda_${typeName}_${fieldName}`,
        resValue.function as FunctionDefinition,
        this.defaultFunctionProps
      );
      dataSource = this.graphqlApi.addLambdaDataSource(
        `DataSource_${typeName}_${fieldName}`,
        lambda
      );
      resolverProps = resValue.resolverProps || {};
      this.functionsByResKey[resKey] = lambda;
    }
    // DataSource resolver
    else if (
      this.isDataSourceResolverProps(resValue as AppSyncApiResolverProps)
    ) {
      resValue = resValue as AppSyncApiResolverProps;
      dataSource = this.dataSourcesByDsKey[resValue.dataSource as string];
      resolverProps = resValue.resolverProps || {};
    }
    // Lambda function
    else {
      resValue = resValue as FunctionDefinition;
      lambda = Fn.fromDefinition(
        scope,
        `Lambda_${typeName}_${fieldName}`,
        resValue,
        this.defaultFunctionProps
      );
      dataSource = this.graphqlApi.addLambdaDataSource(
        `DataSource_${typeName}_${fieldName}`,
        lambda
      );
      resolverProps = {};
      this.functionsByResKey[resKey] = lambda;
    }
    this.dataSourcesByResKey[resKey] = dataSource;

    ///////////////////
    // Create resolver
    ///////////////////
    dataSource.createResolver({ typeName, fieldName, ...resolverProps });

    return lambda;
  }

  private isLambdaResolverProps(object: AppSyncApiResolverProps): boolean {
    return object.function !== undefined;
  }

  private isDataSourceResolverProps(object: AppSyncApiResolverProps): boolean {
    return object.dataSource !== undefined;
  }

  private normalizeResolverKey(resolverKey: string): string {
    const parts = resolverKey.split(/\s+/);

    // Make the first letter of type uppercase
    if (parts[0] && parts[0].length > 0) {
      const type = parts[0].toLowerCase();
      parts[0] = type.charAt(0).toUpperCase() + type.slice(1);
    }

    return parts.join(" ");
  }

  public getFunctionForDataSource(dataSourceKey: string): Fn | undefined {
    return this.functionsByDsKey[dataSourceKey];
  }

  public getFunctionForResolver(resolverKey: string): Fn | undefined {
    return this.functionsByResKey[this.normalizeResolverKey(resolverKey)];
  }

  public getDataSourceForKey(
    dataSourceKey: string
  ): appsync.BaseDataSource | undefined {
    return this.dataSourcesByDsKey[dataSourceKey];
  }

  public getDataSourceForResolver(
    resolverKey: string
  ): appsync.BaseDataSource | undefined {
    return this.dataSourcesByResKey[this.normalizeResolverKey(resolverKey)];
  }

  public attachPermissions(permissions: Permissions): void {
    Object.values(this.functionsByDsKey).forEach((fn) =>
      fn.attachPermissions(permissions)
    );
    Object.values(this.functionsByResKey).forEach((fn) =>
      fn.attachPermissions(permissions)
    );
    this.permissionsAttachedForAllFunctions.push(permissions);
  }

  public attachPermissionsToDataSource(
    dataSourceKey: string,
    permissions: Permissions
  ): void {
    const fn = this.getFunctionForDataSource(dataSourceKey);
    if (!fn) {
      throw new Error(
        `Failed to attach permissions. Function does not exist for data source "${dataSourceKey}".`
      );
    }

    fn.attachPermissions(permissions);
  }

  public attachPermissionsToResolver(
    resolverKey: string,
    permissions: Permissions
  ): void {
    const fn = this.getFunctionForResolver(resolverKey);
    if (!fn) {
      throw new Error(
        `Failed to attach permissions. Function does not exist for resolver "${resolverKey}".`
      );
    }

    fn.attachPermissions(permissions);
  }
}
