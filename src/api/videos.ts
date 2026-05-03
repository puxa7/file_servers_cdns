import { respondWithJSON } from "./json";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { type ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { getBearerToken, validateJWT } from "../auth";
import { type Video, getVideo, updateVideo } from "../db/videos";
import { randomBytes } from "crypto";
import { unlink } from "node:fs/promises";
import { s3 } from "bun";


export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };

  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Video not found");
  }

  if (video.userID !== userID) {
    throw new UserForbiddenError("You are not the owner of this video");
  }

  const MAX_UPLOAD_SIZE = 1 << 30; // 1 GB

  const formData = await req.formData();
  const videoFile = formData.get("video");

  if (!(videoFile instanceof File)) {
    throw new BadRequestError("Video file missing");
  }

  if (videoFile.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("File's size property is greater than the max upload size");
  }

  if (videoFile.type !== "video/mp4") {
    throw new BadRequestError("Only MP4 videos are allowed");
  }

  const extension = videoFile.type.split("/")[1];
  const randomName = randomBytes(32).toString("hex");
  const fileName = `${randomName}.${extension}`;
  const tempFilePath = `${cfg.assetsRoot}/${fileName}`;

  try {
    await Bun.write(tempFilePath, videoFile);

    const processedFilePath = await processVideoForFastStart(tempFilePath);

    const aspectRatio = await getVideoAspectRatio(tempFilePath);

    const s3Key = `${aspectRatio}/${fileName}`;

    const s3File = cfg.s3Client.file(s3Key);

    await s3File.write(Bun.file(processedFilePath), {
      type: videoFile.type,
    });

    const videoURL = `${cfg.s3CfDistribution}/${s3Key}`;
    //const videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${s3Key}`;
    video.videoURL = videoURL;
    updateVideo(cfg.db, video);

    return respondWithJSON(200, video);
  } finally {
    try {
      await unlink(tempFilePath);
    } catch (e) {
      console.error(`Failed to remove temp file ${tempFilePath}:`, e);
    }
    try {
      const processedFilePath = `${tempFilePath}.processed`;
      await unlink(processedFilePath);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`Failed to remove processed file:`, e);
      }
    }
  }
}

export async function getVideoAspectRatio(filePath: string): Promise<string> {
  const proc = Bun.spawn([
    "ffprobe",
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "json",
    filePath
  ]);

  const stdouText = await new Response(proc.stdout).text();
  const stderrText = await new Response(proc.stderr).text();

  const exitCode = await proc.exited;


  if (exitCode !== 0) {
    throw new Error(`ffprobe xd failed with exit code ${exitCode}`);
  }

  const data = JSON.parse(stdouText);

  const stream = data.streams?.[0];

  if (!stream || !stream.width || !stream.height) {
    return "other";
  }

  const width = stream.width;
  const height = stream.height;
  const ratio = width / height;

  const is16_9 = Math.abs(ratio - 16 / 9) < 0.1;
  const is9_16 = Math.abs(ratio - 9 / 16) < 0.1;


  if (is16_9) return "landscape";
  if (is9_16) return "portrait";

  return "other";
}

export async function processVideoForFastStart(inputFilePath: string): Promise<string> {
  const outputFilePath = `${inputFilePath}.processed`;

  const proc = Bun.spawn([
    "ffmpeg",
    "-i", inputFilePath,
    "-movflags", "faststart",
    "-map_metadata", "0",
    "-codec", "copy",
    "-f", "mp4",
    outputFilePath
  ]);

  const stderrText = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`ffmpeg failed to process video: ${stderrText}`);
  }


  return outputFilePath;
}

