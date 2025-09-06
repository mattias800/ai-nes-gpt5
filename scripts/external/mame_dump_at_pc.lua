-- Dump CPU RAM (0x0000-0x07FF) and CPU regs when PC reaches target.
-- Env:
--   MAME_DUMP_RAM: path for RAM bin (default out/mame_ram.bin)
--   MAME_DUMP_REGS: path for regs json (default out/mame_regs.json)
--   MAME_TARGET_PC: hex PC to wait for (default C000)

local ramPath = os.getenv('MAME_DUMP_RAM') or 'out/mame_ram.bin'
local regsPath = os.getenv('MAME_DUMP_REGS') or 'out/mame_regs.json'
local targetPC = tonumber(os.getenv('MAME_TARGET_PC') or 'C000', 16) or 0xC000
-- Optional PC range, default near reset to catch early frame PCs
local rangeEnv = os.getenv('MAME_TARGET_RANGE') or ''
local rstart, rend = 0xC000, 0xC050
if #rangeEnv > 0 then
  local i = string.find(rangeEnv, '-')
  if i then
    local a = string.sub(rangeEnv, 1, i-1)
    local b = string.sub(rangeEnv, i+1)
    local rs = tonumber(a, 16)
    local re = tonumber(b, 16)
    if rs and re then
      if rs > re then rs, re = re, rs end
      rstart, rend = rs, re
    end
  end
end
local debug = os.getenv('MAME_DUMP_DEBUG') == '1'
if debug then
  local r = string.format('%04X-%04X', rstart, rend)
  emu.print_info(string.format('[mame-dump] env RANGE="%s" (parsed=%s)', rangeEnv, r))
end

local cpu = manager.machine.devices[':maincpu'] or manager.machine.devices['maincpu']
if not cpu then emu.print_error('[mame-dump] maincpu not found'); return end
local st = cpu.state
local prog = cpu.spaces and cpu.spaces['program']
if not prog then emu.print_error('[mame-dump] program space not found'); return end

-- Try to install per-instruction hook if debugger is available (requires -debug)
local dbg = nil
pcall(function() dbg = cpu.debug end)
local hooked = false
if dbg and dbg.set_instruction_hook then
  local function ih()
    local pc = 0
    pcall(function() pc = st['PC'].value end)
    if pc == targetPC then
      -- Perform dump immediately from instruction hook
      local A,X,Y,P,S = 0,0,0,0,0
      pcall(function() A = st['A'].value end)
      pcall(function() X = st['X'].value end)
      pcall(function() Y = st['Y'].value end)
      pcall(function() P = st['P'].value end)
      pcall(function() S = st['S'].value end)
      local jf = io.open(regsPath, 'w')
      if jf then
        jf:write(string.format('{"A":%d,"X":%d,"Y":%d,"P":%d,"S":%d,"PC":%d}', A&0xFF, X&0xFF, Y&0xFF, P&0xFF, S&0xFF, pc&0xFFFF))
        jf:close()
      else
        emu.print_error('[mame-dump] cannot open regs json: '..regsPath)
      end
      local f = io.open(ramPath, 'wb')
      if not f then emu.print_error('[mame-dump] cannot open ram path: '..ramPath); return end
      for addr=0,0x7FF do
        local b = prog:read_u8(addr) & 0xFF
        f:write(string.char(b))
      end
      f:close()
      emu.print_info(string.format('[mame-dump] dumped regs+ram at PC=%04X (instr hook)', pc))
      manager.machine:exit()
    end
  end
  dbg:set_instruction_hook(ih)
  hooked = true
  if debug then emu.print_info('[mame-dump] installed instruction hook') end
end

local frameCount = 0

local function dump()
  frameCount = frameCount + 1
  local pc = 0
  local ok = pcall(function() pc = st['PC'].value end)
  if debug and frameCount <= 60 then
    local r = (rstart and rend) and string.format('%04X-%04X', rstart, rend) or 'none'
    emu.print_info(string.format('[mame-dump] frame=%d pc=%04X ok=%s hook=%s range=%s', frameCount, pc, tostring(ok), tostring(hooked), r))
  end
  local inRange = (rstart and rend) and (pc >= rstart and pc <= rend)
  if (pc ~= targetPC) and (not inRange) then return false end
  -- Dump regs
  local A,X,Y,P,S = 0,0,0,0,0
  pcall(function() A = st['A'].value end)
  pcall(function() X = st['X'].value end)
  pcall(function() Y = st['Y'].value end)
  pcall(function() P = st['P'].value end)
  pcall(function() S = st['S'].value end)
  local jf = io.open(regsPath, 'w')
  if jf then
    jf:write(string.format('{"A":%d,"X":%d,"Y":%d,"P":%d,"S":%d,"PC":%d}', A&0xFF, X&0xFF, Y&0xFF, P&0xFF, S&0xFF, pc&0xFFFF))
    jf:close()
  else
    emu.print_error('[mame-dump] cannot open regs json: '..regsPath)
  end
  -- Dump RAM
  local f = io.open(ramPath, 'wb')
  if not f then emu.print_error('[mame-dump] cannot open ram path: '..ramPath); return true end
  for addr=0,0x7FF do
    local b = prog:read_u8(addr) & 0xFF
    f:write(string.char(b))
  end
  f:close()
  emu.print_info(string.format('[mame-dump] dumped regs+ram at PC=%04X', pc))
  manager.machine:exit()
  return true
end

emu.add_machine_frame_notifier(function() dump() end)

