#!/usr/bin/env node
import "source-map-support/register";
import { App } from "aws-cdk-lib";
import { StocksyncStack } from "../lib/stocksync-stack";
import { projectName } from "../lib/config";

const app = new App();
new StocksyncStack(app, `${projectName}-stack`);
