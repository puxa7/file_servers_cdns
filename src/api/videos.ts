import { respondWithJSON } from "./json";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { type ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";
import { randomBytes } from "crypto";
import { unlink } from "node:fs/promises";

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

    const aspectRatio = await getVideoAspectRatio(tempFilePath);

    const s3Key = `${aspectRatio}/${fileName}`;

    const s3File = cfg.s3Client.file(s3Key);

    await s3File.write(Bun.file(tempFilePath), {
      type: videoFile.type,
    });

    const videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${s3Key}`;
    video.videoURL = videoURL;
    updateVideo(cfg.db, video);

    return respondWithJSON(200, video);
  } finally {
    try {
      await unlink(tempFilePath);
    } catch (e) {
      console.error(`Failed to remove temp file ${tempFilePath}:`, e);
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


  if(exitCode !== 0){
    throw new Error(`ffprobe xd failed with exit code ${exitCode}`);
  }

  const data = JSON.parse(stdouText);

  const stream = data.streams?.[0];

  if(!stream || !stream.width || !stream.height){
    return "other";
  }

  const width = stream.width;
  const height = stream.height;
  const ratio = width/height; 

  const is16_9 = Math.abs(ratio - 16/9) < 0.1;
  const is9_16 = Math.abs(ratio - 9/16) < 0.1;

  //console.log(is16_9);
  //console.log(is9_16);

  if(is16_9) return "landscape";
  if(is9_16) return "portrait";

  return "other";

}