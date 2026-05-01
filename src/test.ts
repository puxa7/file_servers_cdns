import { type ApiConfig } from "./config";
import type { BunRequest } from "bun";
import { respondWithJSON } from "./api/json";
import { file } from "bun";
import { getVideoAspectRatio } from "./api/videos";

export async function handlerTest(cfg: ApiConfig, req: BunRequest) {

    console.log("Próba Testu!");

    //const formData = await req.formData();

    //const file = formData.get("thumbnail");

    //if (!file || !(file instanceof File)) {
    //    return respondWithJSON(400, { error: "Thumbnail file missing or invalid" });
    // }

    //const extension = file.type.split("/")[1];

    // console.log(file.type.split("/"));

    getVideoAspectRatio("./samples/boots-video-vertical.mp4");
  
    return respondWithJSON(200, { message: "Test OK!" });
}
