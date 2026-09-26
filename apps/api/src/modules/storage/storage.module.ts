import { Global, Module } from "@nestjs/common";
import { ObjectStorage } from "./object-storage";

@Global()
@Module({ providers: [ObjectStorage], exports: [ObjectStorage] })
export class StorageModule {}
