import fsExtra from 'fs-extra';
import { Request } from 'express';

/**
 * This method will delete all temporary uploaded files from the request
 */
export async function clearTempFiles(
  req: Request & { files: any }
): Promise<void> {
  if (!req.files) {
    return;
  }

  await Promise.all(
    Object.keys(req.files).map((file) =>
      req.files[file].tempFilePath !== undefined &&
      req.files[file].tempFilePath !== ''
        ? fsExtra.remove(req.files[file].tempFilePath)
        : Promise.resolve()
    )
  );
}