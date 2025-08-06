import axios from 'axios';
import * as fs from 'fs';

/**
 * Downloads the KAI plugin VSIX file from the default URL to the local directory.
 * Uses environment variables DEFAULT_VSIX_DOWNLOAD_URL and VSIX_FILE_NAME.
 */
export async function downloadFile(url: string, outputFile: string): Promise<void> {
  const writer = fs.createWriteStream(outputFile);
  const response = await fetchUrl(url);
  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

async function fetchUrl(defaultUrl: string) {
  try {
    return await axios({
      url: defaultUrl,
      method: 'GET',
      responseType: 'stream',
    });
  } catch (error) {
    console.error('Error fetching URL:', error);
    throw error;
  }
}
