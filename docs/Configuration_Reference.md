# Configuration Reference

## [offset]

zswitch_x_pos: X position of Z switch
zswitch_y_pos: Y position of Z switch
zswitch_z_pos: Trigger height

samples: Number of probe samples per batch
samples_tolerance: Maximum allowed spread
samples_max_count: Retry limit

z_calc_method:
  - median
  - average
  - trimmed

z_trim_count:
  Number of values removed per side (trimmed mode)

default_ref_tool:
  Default Master Tool number
