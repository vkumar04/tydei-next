# Oracle: cog-in-term-scope — PASS

**Run:** 2026-04-29T21:17:12.515Z
**Duration:** 1ms
**Checks:** 12/12 passed

## Results

- ✅ **[buildCategoryWhereClause] all_products → empty fragment (no narrowing)**
  - expected={} got={}
- ✅ **[buildCategoryWhereClause] specific_category + populated → category IN list**
  - expected={"category":{"in":["Spine","Joint Replacement"]}} got={"category":{"in":["Spine","Joint Replacement"]}}
- ✅ **[buildCategoryWhereClause] specific_category + empty → empty fragment**
  - expected={} got={}
- ✅ **[buildCategoryWhereClause] specific_category + null categories → empty fragment**
  - expected={} got={}
- ✅ **[buildCategoryWhereClause] no scope set → empty fragment**
  - expected={} got={}
- ✅ **[buildCategoryWhereClause] productScope alias accepted (treated as appliesTo)**
  - expected={"category":{"in":["Spine"]}} got={"category":{"in":["Spine"]}}
- ✅ **[buildCategoryWhereClause] duplicate category names deduplicated while preserving order**
  - expected={"category":{"in":["Spine","Joint Replacement"]}} got={"category":{"in":["Spine","Joint Replacement"]}}
- ✅ **[buildUnionCategoryWhereClause] no terms → empty fragment**
  - expected={} got={}
- ✅ **[buildUnionCategoryWhereClause] any all_products term → empty fragment (widest wins)**
  - expected={} got={}
- ✅ **[buildUnionCategoryWhereClause] every term specific_category → union of categories**
  - expected={"category":{"in":["Spine","Joint Replacement"]}} got={"category":{"in":["Spine","Joint Replacement"]}}
- ✅ **[buildUnionCategoryWhereClause] specific_category with empty categories → empty fragment (treat as wide)**
  - expected={} got={}
- ✅ **[buildUnionCategoryWhereClause] overlapping category sets → deduped union**
  - expected={"category":{"in":["Spine","Joint Replacement","Trauma"]}} got={"category":{"in":["Spine","Joint Replacement","Trauma"]}}
