import {test,expect} from '@playwright/test';
test('invalid reviews keep the detail usable and explicit retry recovers the summary',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));let valid=false;
 await page.route('**/places/1/reviews/summary',r=>r.fulfill({json:valid?{average_rating:4.5,review_count:2}:[]}));
 await page.goto('/place/db-1');await expect(page.getByText('Browser Test Museum',{exact:true}).first()).toBeVisible();
 await expect(page.getByText('Dữ liệu đánh giá chưa hợp lệ. Hãy thử tải lại.',{exact:true})).toBeVisible();
 valid=true;await page.getByRole('button',{name:'Thử tải lại đánh giá',exact:true}).click();
 await expect(page.getByText('4.5 / 5 · 2 đánh giá',{exact:true})).toBeVisible();expect(errors).toEqual([]);
});
