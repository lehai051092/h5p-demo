import * as H5P from '@lumieducation/h5p-server';
import {IContentMetadata, IUser} from '@lumieducation/h5p-server';

/**
 * Create a H5PEditor object.
 * Which storage classes are used depends on the configuration values set in
 * the environment variables. If you set no environment variables, the local
 * filesystem storage classes will be used.
 *
 * @param config the configuration object
 * @param urlGenerator
 * @param permissionSystem
 * @param localLibraryPath a path in the local filesystem in which the H5P libraries (content types) are stored
 * @param localContentPath a path in the local filesystem in which H5P content will be stored
 * @param localTemporaryPath a path in the local filesystem in which temporary files will be stored.
 * @param localContentUserDataPath
 * @param translationCallback a function that is called to retrieve translations of keys in a certain language; the keys use the i18next format (e.g. namespace:key).
 * @param hooks
 * @returns a H5PEditor object
 */
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
): Promise<H5P.H5PEditor | undefined> {
  if (localContentUserDataPath == null || localContentPath == null || localTemporaryPath == null) {
    return;
  }

  const contentUserDataStorage =
    new H5P.fsImplementations.FileContentUserDataStorage(
      localContentUserDataPath
    );

  return new H5P.H5PEditor(
    new H5P.cacheImplementations.CachedKeyValueStorage('h5p'), // sử dụng bộ lưu trữ khóa-giá trị mặc định
    config,
    new H5P.fsImplementations.FileLibraryStorage(localLibraryPath),
    new H5P.fsImplementations.FileContentStorage(localContentPath),
    new H5P.fsImplementations.DirectoryTemporaryFileStorage(localTemporaryPath),
    translationCallback,
    urlGenerator,
    {
      enableHubLocalization: true,
      enableLibraryNameLocalization: true,
      hooks,
      permissionSystem
    },
    contentUserDataStorage
  );
}
