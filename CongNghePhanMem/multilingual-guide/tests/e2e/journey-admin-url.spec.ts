import { test, expect } from "@playwright/test";
const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==",
  "base64",
);
test.beforeEach(async ({ page }) => {
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({ contentType: "image/png", body: pixel }),
  );
  await page.route("https://upload.wikimedia.org/**", (route) =>
    route.fulfill({ contentType: "image/png", body: pixel }),
  );
});
async function admin(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page
    .getByLabel("Địa chỉ email", { exact: true })
    .fill("admin@e2e.example.com");
  await page.getByLabel("Mật khẩu", { exact: true }).fill("TestPassword123!");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
}
test("admin selects 25 named PostgreSQL stops across pages and preserves reordered stops", async ({
  page,
  request,
}) => {
  await admin(page);
  await page.getByRole("button", { name: "Hành trình", exact: true }).click();
  await page.getByRole("button", { name: "＋ Thêm mới", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const loadedChoices = page.waitForResponse(response => { const url=new URL(response.url()); return url.pathname==='/admin/places' && url.searchParams.get('q')==='Journey Admin fixture' && response.status()===200; });
  await dialog
    .getByLabel("Tên hành trình", { exact: true })
    .fill("Browser 25-stop ordered fixture");
  await dialog
    .getByLabel("Tìm địa điểm để thêm vào hành trình", { exact: true })
    .fill("Journey Admin fixture");
  await loadedChoices;
  const choices = dialog.getByRole("button", {
    name: /^Thêm Journey Admin fixture/,
  });
  await expect(choices).toHaveCount(24);
  const names: string[] = [];
  for (let i = 0; i < 24; i++) {
    const name = (await choices.first().getAttribute("aria-label"))!.slice(
      "Thêm ".length,
    );
    names.push(name);
    await choices.first().click();
    await expect(choices).toHaveCount(23 - i);
  }
  await expect(choices).toHaveCount(0);
  await dialog.getByRole("button", { name: "Sau →", exact: true }).click();
  await expect(choices).toHaveCount(6);
  names.push(
    (await choices.first().getAttribute("aria-label"))!.slice("Thêm ".length),
  );
  await choices.first().click();
  await dialog
    .getByText(`25. ${names[24]}`, { exact: true })
    .locator("..")
    .getByRole("button", { name: "↑ Lên", exact: true })
    .click();
  [names[23], names[24]] = [names[24], names[23]];
  await dialog
    .getByRole("button", { name: "Lưu thay đổi", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByText("Đã lưu vào cơ sở dữ liệu.", { exact: true }),
  ).toBeVisible();
  const login = await request.post("http://127.0.0.1:8765/auth/login", {
    data: { email: "admin@e2e.example.com", password: "TestPassword123!" },
  });
  const token = (await login.json()).access_token;
  const response = await request.get(
    "http://127.0.0.1:8765/admin/journeys?q=Browser%2025-stop",
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const journey = (await response.json()).items[0];
  expect(journey.stops.map((row: { name: string }) => row.name)).toEqual(names);
  expect(new Set(journey.place_ids).size).toBe(25);
});
test("URL preview can be edited, imported only as draft with pending licensed photo, and detects repeat", async ({
  page,
}) => {
  await admin(page);
  await page.getByText("Nhập địa danh", { exact: true }).click();
  await page
    .getByLabel("Liên kết địa danh", { exact: true })
    .fill("https://vi.wikipedia.org/wiki/Browser_URL_Import_Fixture");
  await page
    .getByRole("button", { name: "Xem trước liên kết", exact: true })
    .click();
  await expect(page.getByLabel("Nhập URL name", { exact: true })).toHaveValue(
    "URL Import Browser Fixture",
  );
  await expect(page.getByText(/Browser fixture author · CC0/)).toBeVisible();
  await page
    .getByLabel("Nhập URL name", { exact: true })
    .fill("URL Import Browser Fixture edited");
  await page
    .getByRole("button", { name: "Lưu địa danh thành bản nháp", exact: true })
    .click();
  await expect(
    page.getByText(/Đã lưu bản nháp: URL Import Browser Fixture edited/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Xem trước liên kết", exact: true })
    .click();
  await expect(page.getByText(/Địa danh đã tồn tại/)).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Lưu địa danh thành bản nháp",
      exact: true,
    }),
  ).toBeDisabled();
  await page.getByText("Địa điểm POI", { exact: true }).click();
  await page
    .getByPlaceholder("Tìm kiếm…")
    .fill("URL Import Browser Fixture edited");
  await page.getByRole("button", { name: "Sửa", exact: true }).first().click();
  await expect(
    page.getByText("Chưa sử dụng", { exact: true }).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Đặt làm ảnh bìa", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Gỡ ảnh khỏi địa điểm", exact: true }),
  ).toBeVisible();
});
test("direct built routes mount without page errors and broken tiles do not remove journey markers", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.abort(),
  );
  for (const route of [
    "/login",
    "/map",
    "/admin",
    "/journeys",
    "/place/db-1",
  ]) {
    await page.goto(route);
    await expect(page.locator("body")).not.toBeEmpty();
  }
  await page.goto("/journeys");
  await page
    .getByRole("button", { name: "Browser Journey Fixture", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Bắt đầu hành trình", exact: true })
    .click();
  await expect(page.locator(".journey-stop-marker")).toHaveCount(2);
  await expect(page.locator(".journey-illustration")).toHaveCount(1);
  await expect(
    page.getByText("Đường nối minh họa, không phải tuyến đường thực tế.", {
      exact: false,
    }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('mobile journey modal keeps save visible while selecting multiple stops', async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await admin(page);
  await page.getByRole('button',{name:'Hành trình',exact:true}).click();
  await page.getByRole('button',{name:'＋ Thêm mới',exact:true}).click();
  const dialog=page.getByRole('dialog');
  const loadedChoices = page.waitForResponse(response => { const url=new URL(response.url()); return url.pathname==='/admin/places' && url.searchParams.get('q')==='Journey Admin fixture' && response.status()===200; });
  await dialog.getByLabel('Tên hành trình',{exact:true}).fill('Mobile three-stop fixture');
  await dialog.getByLabel('Tìm địa điểm để thêm vào hành trình',{exact:true}).fill('Journey Admin fixture');
  await loadedChoices;
  const choices=dialog.getByRole('button',{name:/^Thêm Journey Admin fixture/});
  await expect(choices).toHaveCount(24);
  for(let index=0;index<3;index++){await choices.first().click();await expect(choices).toHaveCount(23-index);}
  const save=dialog.getByRole('button',{name:'Lưu thay đổi',exact:true});
  await expect(save).toBeInViewport();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/admin-mobile-journey.png'});
  await save.click();
  await expect(dialog).toHaveCount(0);
});
