import { caching } from 'cache-manager';
import redisStore from 'cache-manager-redis-store';
import ioredis from 'ioredis';
import type { Db } from 'mongodb';
import * as H5P from '@lumieducation/h5p-server';
import * as dbImplementations from '@lumieducation/h5p-mongos3';
import RedisLockProvider from '@lumieducation/h5p-redis-lock';
import { ILockProvider, IUser, IContentMetadata } from '@lumieducation/h5p-server';

let mongoDb;
async function getMongoDb(): Promise<Db> {
    if (!mongoDb) {
        mongoDb = await dbImplementations.initMongo();
    }
    return mongoDb;
}

export default async function createH5PEditor(
    config: H5P.IH5PConfig,
    urlGenerator: H5P.IUrlGenerator,
    permissionSystem: H5P.IPermissionSystem,
    localLibraryPath: string,
    localContentPath?: string,
    localTemporaryPath?: string,
    localContentUserDataPath?: string,
    translationCallback?: H5P.ITranslationFunction,
    hooks?: {
        contentWasDeleted?: (contentId: string, user: IUser) => Promise<void>;
        contentWasUpdated?: (
            contentId: string,
            metadata: IContentMetadata,
            parameters: any,
            user: IUser
        ) => Promise<void>;
        contentWasCreated?: (
            contentId: string,
            metadata: IContentMetadata,
            parameters: any,
            user: IUser
        ) => Promise<void>;
    }
): Promise<H5P.H5PEditor> {
    let cache: Cache;
    if (process.env.CACHE === 'in-memory') {
        cache = caching({
            store: 'memory',
            ttl: 60 * 60 * 24,
            max: 2 ** 10
        });
    } else if (process.env.CACHE === 'redis') {
        cache = caching({
            store: redisStore,
            host: process.env.REDIS_HOST,
            port: process.env.REDIS_PORT,
            auth_pass: process.env.REDIS_AUTH_PASS,
            db: process.env.REDIS_DB,
            ttl: 60 * 60 * 24
        });
    } else {
        // using no cache
    }

    let lock: ILockProvider;
    if (process.env.LOCK === 'redis') {
        lock = new RedisLockProvider(
            new ioredis(
                Number.parseInt(process.env.LOCK_REDIS_PORT),
                process.env.LOCK_REDIS_HOST,
                {
                    db: Number.parseInt(process.env.LOCK_REDIS_DB)
                }
            )
        );
    } else {
        lock = new H5P.SimpleLockProvider();
    }

    // Depending on the environment variables we use different implementations
    // of the storage interfaces.

    let libraryStorage: H5P.ILibraryStorage;
    if (process.env.LIBRARYSTORAGE === 'mongo') {
        const mongoLibraryStorage = new dbImplementations.MongoLibraryStorage(
            (await getMongoDb()).collection(
                process.env.LIBRARY_MONGO_COLLECTION
            )
        );
        await mongoLibraryStorage.createIndexes();
        libraryStorage = mongoLibraryStorage;
    } else if (process.env.LIBRARYSTORAGE === 'mongos3') {
        const mongoS3LibraryStorage =
            new dbImplementations.MongoS3LibraryStorage(
                dbImplementations.initS3({
                    s3ForcePathStyle: true,
                    signatureVersion: 'v4'
                }),
                (await getMongoDb()).collection(
                    process.env.LIBRARY_MONGO_COLLECTION
                ),
                {
                    s3Bucket: process.env.LIBRARY_AWS_S3_BUCKET,
                    maxKeyLength: process.env.AWS_S3_MAX_FILE_LENGTH
                        ? Number.parseInt(
                              process.env.AWS_S3_MAX_FILE_LENGTH,
                              10
                          )
                        : undefined
                }
            );
        await mongoS3LibraryStorage.createIndexes();
        libraryStorage = mongoS3LibraryStorage;
    } else {
        libraryStorage = new H5P.fsImplementations.FileLibraryStorage(
            localLibraryPath
        );
    }

    let contentUserDataStorage: H5P.IContentUserDataStorage;
    if (process.env.USERDATASTORAGE === 'mongo') {
        const mongoContentUserDataStorage =
            new dbImplementations.MongoContentUserDataStorage(
                (await getMongoDb()).collection(
                    process.env.USERDATA_MONGO_COLLECTION
                ),
                (await getMongoDb()).collection(
                    process.env.FINISHED_MONGO_COLLECTION
                )
            );
        await mongoContentUserDataStorage.createIndexes();
        contentUserDataStorage = mongoContentUserDataStorage;
    } else if (
        !process.env.USERDATASTORAGE ||
        process.env.USERDATASTORAGE === 'file'
    ) {
        contentUserDataStorage =
            new H5P.fsImplementations.FileContentUserDataStorage(
                localContentUserDataPath
            );
    }

    const h5pEditor = new H5P.H5PEditor(
        new H5P.cacheImplementations.CachedKeyValueStorage('kvcache', cache), // this is a general-purpose cache
        config,
        process.env.CACHE
            ? new H5P.cacheImplementations.CachedLibraryStorage(
                  libraryStorage,
                  cache
              )
            : libraryStorage,
        process.env.CONTENTSTORAGE !== 'mongos3'
            ? new H5P.fsImplementations.FileContentStorage(localContentPath)
            : new dbImplementations.MongoS3ContentStorage(
                  dbImplementations.initS3({
                      s3ForcePathStyle: true,
                      signatureVersion: 'v4'
                  }),
                  (await getMongoDb()).collection(
                      process.env.CONTENT_MONGO_COLLECTION
                  ),
                  {
                      s3Bucket: process.env.CONTENT_AWS_S3_BUCKET,
                      maxKeyLength: process.env.AWS_S3_MAX_FILE_LENGTH
                          ? Number.parseInt(
                                process.env.AWS_S3_MAX_FILE_LENGTH,
                                10
                            )
                          : undefined
                  }
              ),
        process.env.TEMPORARYSTORAGE === 's3'
            ? new dbImplementations.S3TemporaryFileStorage(
                  dbImplementations.initS3({
                      s3ForcePathStyle: true,
                      signatureVersion: 'v4'
                  }),
                  {
                      s3Bucket: process.env.TEMPORARY_AWS_S3_BUCKET,
                      maxKeyLength: process.env.AWS_S3_MAX_FILE_LENGTH
                          ? Number.parseInt(
                                process.env.AWS_S3_MAX_FILE_LENGTH,
                                10
                            )
                          : undefined
                  }
              )
            : new H5P.fsImplementations.DirectoryTemporaryFileStorage(
                  localTemporaryPath
              ),
        translationCallback,
        urlGenerator,
        {
            enableHubLocalization: true,
            enableLibraryNameLocalization: true,
            lockProvider: lock,
            hooks,
            permissionSystem
        },
        contentUserDataStorage
    );

    // Set bucket lifecycle configuration for S3 temporary storage to make
    // sure temporary files expire.
    if (
        h5pEditor.temporaryStorage instanceof
        dbImplementations.S3TemporaryFileStorage
    ) {
        await (
            h5pEditor.temporaryStorage as any
        ).setBucketLifecycleConfiguration(h5pEditor.config);
    }

    return h5pEditor;
}
