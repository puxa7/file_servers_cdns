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

    const s3File = cfg.s3Client.file(fileName);

    await s3File.write(Bun.file(tempFilePath), {
      type: videoFile.type,
    });

    const videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${fileName}`;
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
