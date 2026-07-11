import { describe, expect, it } from "vitest";
import { lookupGiftByImageKey, lookupGiftByImageUrl } from "../src/domain/giftCatalog";

const identifiedGifts = [
  ["45d500ac5d4de4da92258d0fc6d0906a", "暮光明珠", 888],
  ["6f039b0a70e7dd96108181bb61588048", "真的爱你", 520],
  ["ed7bcb1cb326731728b640945a1ac52a", "陪伴心愿包", 99],
  ["adf2ee6bf03d10de7bb2025da8ad3f17", "666", 1],
  ["95063941afee43fe156f4906c194284d", "点点星光", 1]
] as const;

describe("identified Douyin web gifts", () => {
  it.each(identifiedGifts)("resolves %s as %s worth %i diamonds", (imageKey, name, diamondCount) => {
    expect(lookupGiftByImageKey(imageKey)).toEqual({
      name,
      diamondCount,
      source: "catalog-image",
      confidence: "exact"
    });
  });

  it("extracts an identified key from a Douyin image URL", () => {
    expect(
      lookupGiftByImageUrl(
        "https://p3-webcast.douyinpic.com/img/webcast/45d500ac5d4de4da92258d0fc6d0906a.png~tplv-obj.image"
      )
    ).toMatchObject({ name: "暮光明珠", diamondCount: 888 });
  });
});
