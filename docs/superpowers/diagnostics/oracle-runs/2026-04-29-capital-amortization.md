# Oracle: capital-amortization — PASS

**Run:** 2026-04-29T21:17:12.871Z
**Duration:** 1ms
**Checks:** 24/24 passed

## Results

- ✅ **[monthly 60mo @ 5%] period count == ceil(term/cadence)**
  - app=60 oracle=60
- ✅ **[monthly 60mo @ 5%] periodic payment matches PMT (±$0.01)**
  - app=$18871.23 oracle=$18871.23
- ✅ **[monthly 60mo @ 5%] total payments == payment × n (±$0.05)**
  - app=$1132274.02 oracle=$1132274.02
- ✅ **[monthly 60mo @ 5%] principal sum == financed (±$0.05)**
  - app=$1000000.00 financed=$1000000.00
- ✅ **[monthly 60mo @ 5%] principal + interest == total (±$0.01)**
  - principal=$1000000.00 interest=$132274.02 total=$1132274.02
- ✅ **[monthly 60mo @ 5%] interest sum matches oracle (±$0.05)**
  - app=$132274.02 oracle=$132274.02
- ✅ **[quarterly 36mo @ 4.5%] period count == ceil(term/cadence)**
  - app=12 oracle=12
- ✅ **[quarterly 36mo @ 4.5%] periodic payment matches PMT (±$0.01)**
  - app=$44776.01 oracle=$44776.01
- ✅ **[quarterly 36mo @ 4.5%] total payments == payment × n (±$0.05)**
  - app=$537312.16 oracle=$537312.16
- ✅ **[quarterly 36mo @ 4.5%] principal sum == financed (±$0.05)**
  - app=$500000.00 financed=$500000.00
- ✅ **[quarterly 36mo @ 4.5%] principal + interest == total (±$0.01)**
  - principal=$500000.00 interest=$37312.16 total=$537312.16
- ✅ **[quarterly 36mo @ 4.5%] interest sum matches oracle (±$0.05)**
  - app=$37312.16 oracle=$37312.16
- ✅ **[monthly 24mo @ 0% (zero-rate edge case)] period count == ceil(term/cadence)**
  - app=24 oracle=24
- ✅ **[monthly 24mo @ 0% (zero-rate edge case)] periodic payment matches PMT (±$0.01)**
  - app=$4166.67 oracle=$4166.67
- ✅ **[monthly 24mo @ 0% (zero-rate edge case)] total payments == payment × n (±$0.05)**
  - app=$100000.00 oracle=$100000.00
- ✅ **[monthly 24mo @ 0% (zero-rate edge case)] principal sum == financed (±$0.05)**
  - app=$100000.00 financed=$100000.00
- ✅ **[monthly 24mo @ 0% (zero-rate edge case)] principal + interest == total (±$0.01)**
  - principal=$100000.00 interest=$0.00 total=$100000.00
- ✅ **[monthly 24mo @ 0% (zero-rate edge case)] interest sum matches oracle (±$0.05)**
  - app=$0.00 oracle=$0.00
- ✅ **[quarterly 13mo @ 6% (non-integer cadence — round-up to 5 periods)] period count == ceil(term/cadence)**
  - app=5 oracle=5
- ✅ **[quarterly 13mo @ 6% (non-integer cadence — round-up to 5 periods)] periodic payment matches PMT (±$0.01)**
  - app=$41817.86 oracle=$41817.86
- ✅ **[quarterly 13mo @ 6% (non-integer cadence — round-up to 5 periods)] total payments == payment × n (±$0.05)**
  - app=$209089.32 oracle=$209089.32
- ✅ **[quarterly 13mo @ 6% (non-integer cadence — round-up to 5 periods)] principal sum == financed (±$0.05)**
  - app=$200000.00 financed=$200000.00
- ✅ **[quarterly 13mo @ 6% (non-integer cadence — round-up to 5 periods)] principal + interest == total (±$0.01)**
  - principal=$200000.00 interest=$9089.32 total=$209089.32
- ✅ **[quarterly 13mo @ 6% (non-integer cadence — round-up to 5 periods)] interest sum matches oracle (±$0.05)**
  - app=$9089.32 oracle=$9089.32
