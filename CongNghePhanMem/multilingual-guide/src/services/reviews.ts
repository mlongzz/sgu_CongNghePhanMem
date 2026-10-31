export type Review = {id:number;user_id:number;rating:number;comment:string|null};
export type ReviewSummary = {average_rating:number|null;review_count:number};
const record=(value:unknown):value is Record<string,unknown>=>!!value && typeof value==='object' && !Array.isArray(value);
export function validReview(value:unknown):value is Review {
  return record(value) && Number.isSafeInteger(value.id) && Number(value.id)>0 && Number.isSafeInteger(value.user_id) && Number(value.user_id)>0 && Number.isInteger(value.rating) && Number(value.rating)>=1 && Number(value.rating)<=5 && (value.comment===null || typeof value.comment==='string' && value.comment.length<=2000);
}
export function validReviewSummary(value:unknown):value is ReviewSummary {
  return record(value) && Number.isSafeInteger(value.review_count) && Number(value.review_count)>=0 && (value.average_rating===null || typeof value.average_rating==='number' && Number.isFinite(value.average_rating) && value.average_rating>=0 && value.average_rating<=5);
}
