/* 護理核對欄位定義（原型第 (18) 版 FIELD_DEFS、examDefs、fieldDefs，內容逐字沿用）。
 * 用途：文件檢視頁顯示「確認後的內容」的欄位名稱；階段 7 護理逐欄核對（assessment.html）也用這份定義。
 * 不要改欄位 key（已確認的資料存在 medical_facts，以 key 對應）。 */
import { NEED_WORD } from './core.js';

export const LAB_PH = '每行一項：項目｜數值｜單位｜參考區間｜異常（H／L／無／未判讀）\n例：Hb｜11.2｜g/dL｜12–16｜L\n報告只有文字判讀時寫：文字判讀：（照報告原文）';
export const FIELD_DEFS = {
  /* 出院病歷摘要：先分「住院出院摘要」與「門診／近期醫療摘要」；出院日期只有住院摘要需要。DNR 不在病摘核對（由評估時另行確認） */
  summary:[{k:'stype',label:'摘要類型',risk:true,choice:true,quick:['住院出院摘要','門診／近期醫療摘要']},{k:'dx',label:'主要診斷',risk:true,type:'dxlist',quick:['文件未記載']},{k:'dc',label:'出院日期（住院出院摘要才需要）',type:'date',when:{k:'stype',in:['住院出院摘要']}},{k:'tube',label:'管路',risk:true,quick:['無','文件未記載']},{k:'allergy',label:'藥物過敏',risk:true,quick:['無已知過敏','文件未記載']},{k:'wound',label:'傷口',quick:['無','文件未記載']}],
  meds:[{k:'meds',label:'用藥清單（每行一項，含劑量與頻次）',risk:true,type:'textarea'},{k:'note',label:'給藥注意',quick:['文件未記載']}],
  xray:[{k:'res',label:'判讀結果（照報告原文）',risk:true,quick:['文件未記載']}],
  stool:[{k:'res',label:'檢驗結果（照報告原文）',risk:true,quick:['文件未記載']}],
  diag:[{k:'dxCert',label:'診斷內容',risk:true,type:'textarea'},{k:'certDate',label:'開立日期',type:'date'}],
  labs:[{k:'labs',label:'檢驗及影像結果',type:'labs',ph:LAB_PH,quick:['文件未記載']}],
  followup:[{k:'nextVisit',label:'回診科別、日期與追蹤事項',type:'textarea'}],
  tubeCare:[{k:'tubeCare',label:'管路照護重點（種類、尺寸、更換日期與頻率、注意事項）',risk:true,type:'textarea',quick:['文件未記載']}],
  woundCare:[{k:'woundCare',label:'傷口照護重點（位置、分級、換藥方式與頻率）',risk:true,type:'textarea',quick:['文件未記載']}],
  rehab:[{k:'mobility',label:'行動能力與復健重點',type:'textarea',quick:['文件未記載']}],
  swallow:[{k:'swallow',label:'吞嚥能力與飲食質地',risk:true,quick:['可正常由口進食','需軟質或剁碎','需流質或增稠','管灌，不可由口進食','文件未記載']}],
  elim:[{k:'elim',label:'排泄與睡眠照護重點',type:'textarea',quick:['文件未記載']}]
};
/* 體檢報告：依機構要求的包含項目逐項核對（可一次上傳整份報告） */
export function examDefs(it){
  return (it.parts || []).filter(p => p.need !== '不適用').flatMap(p => [
    {k:'p_' + p.k, label:`${p.name}：報告是否包含（${NEED_WORD[p.need]}）`, risk: p.need === '必備', partNeed:p.need, choice:true, quick: p.need === '必備' ? ['報告內有','報告內未包含'] : ['報告內有','報告內未包含','本案不需要']},
    {k:'p_' + p.k + '_r', label:`${p.name}：檢查結果`, type:'labs', ph:LAB_PH, risk: p.need === '必備', when:{k:'p_' + p.k, in:['報告內有']}, quick:['報告未列此項結果']}])
    .concat([{k:'examNote', label:'醫師註記的異常或建議（照報告原文）', type:'textarea', quick:['文件未記載']}]);
}
/* 效期項目的「檢查日期」由行政確認（F6），護理只核對醫療內容（F8） */
export const fieldDefs = it => (it.parts || []).length ? examDefs(it) : (FIELD_DEFS[it.key] || [{k:'content',label:'文件重點',risk:true,type:'textarea'}]);
