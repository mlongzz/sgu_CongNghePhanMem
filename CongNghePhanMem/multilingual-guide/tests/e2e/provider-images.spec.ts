import { test, expect } from "@playwright/test";
const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==",
  "base64",
);
test("Wikipedia exact Commons image keeps credit and license across map selection and reload", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: 10.7764,
    longitude: 106.6993,
    accuracy: 5,
  });
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({ contentType: "image/png", body: pixel }),
  );
  await page.route("https://upload.wikimedia.org/**", (route) =>
    route.fulfill({ contentType: "image/png", body: pixel }),
  );
  await page.route("https://vi.wikipedia.org/w/api.php?**", (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("list") === "geosearch")
      return route.fulfill({
        json: {
          query: {
            geosearch: [
              {
                pageid: 998877,
                ns: 0,
                title: "Wiki Commons Photo Fixture",
                lat: 10.7764,
                lon: 106.6993,
              },
            ],
          },
        },
      });
    if (params.get("prop") === "pageimages")
      return route.fulfill({
        json: {
          query: {
            pages: [{ pageid: 998877, ns: 0, pageimage: "Fixture photo.jpg" }],
          },
        },
      });
    return route.fulfill({
      json: {
        query: {
          pages: [
            {
              pageid: 998877,
              ns: 0,
              title: "Wiki Commons Photo Fixture",
              extract: "Explicit browser photo fixture narration.",
              coordinates: [{ lat: 10.7764, lon: 106.6993, globe: "earth" }],
            },
          ],
        },
      },
    });
  });
  await page.route("https://commons.wikimedia.org/w/api.php?**", (route) =>
    route.fulfill({
      json: {
        query: {
          pages: [
            {
              title: "File:Fixture photo.jpg",
              imageinfo: [
                {
                  thumburl:
                    "https://upload.wikimedia.org/wikipedia/commons/a/a1/Fixture_photo.jpg",
                  extmetadata: {
                    Artist: { value: "<a>Commons fixture author</a>" },
                    LicenseShortName: { value: "CC BY-SA 4.0" },
                  },
                },
              ],
            },
          ],
        },
      },
    }),
  );
  await page.goto("/map");
  await page.getByRole("button", { name: "Định vị lại", exact: true }).count();
  await page.getByRole("button", { name: "Dùng GPS và tìm địa danh", exact: true }).click();
  await expect(
    page
      .locator(
        'img[src="https://upload.wikimedia.org/wikipedia/commons/a/a1/Fixture_photo.jpg"]',
      )
      .first(),
  ).toBeVisible();
  await page
    .getByLabel("Chi tiết Wiki Commons Photo Fixture", { exact: true })
    .click();
  await expect(
    page.getByText(/Nguồn ảnh: Commons fixture author · CC BY-SA 4.0/),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText(/Nguồn ảnh: Commons fixture author · CC BY-SA 4.0/),
  ).toBeVisible();
});
