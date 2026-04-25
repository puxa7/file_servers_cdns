import { type ApiConfig } from "./config";
import type { BunRequest } from "bun";
import { respondWithJSON } from "./api/json";
import { file } from "bun";

export async function handlerTest(cfg: ApiConfig, req: BunRequest) {

    console.log("xdddd");

    const formData = await req.formData();

    const file = formData.get("thumbnail");

    if (!file || !(file instanceof File)) {
        return respondWithJSON(400, { error: "Thumbnail file missing or invalid" });
    }

    const extension = file.type.split("/")[1];

    console.log(file.type.split("/"));
  
    return respondWithJSON(200, { message: "Test OK!" });
}
