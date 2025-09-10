-- scripts/nestest_mame_auto_hook.lua
-- Run nestest in auto mode with instruction hook logging registers each instruction.
-- Env:
--   MAME_OUT  : output file (default out/nestest-mame-auto.log)
--   MAME_INST : number of instructions to record (default 50000)

local out = os.getenv('MAME_OUT') or 'out/nestest-mame-auto.log'
local inst = tonumber(os.getenv('MAME_INST') or '50000') or 50000

local cpu = manager.machine.devices[':maincpu'] or manager.machine.devices['maincpu']
if not cpu or not cpu.state then emu.print_error('[nestest-auto-hook] maincpu/state not available'); return end
local st = cpu.state

-- Initialize canonical auto-mode state
pcall(function() st['PC'].value = 0xC000 end)
pcall(function() st['A'].value  = 0x00   end)
pcall(function() st['X'].value  = 0x00   end)
pcall(function() st['Y'].value  = 0x00   end)
pcall(function() st['P'].value  = 0x24   end)
pcall(function() st['S'].value  = 0xFD   end)

local function fmt2(v) v = v & 0xFF; return string.format('%02X', v) end
local function fmt4(v) v = v & 0xFFFF; return string.format('%04X', v) end

local fh = io.open(out, 'w')
if not fh then emu.print_error('[nestest-auto-hook] cannot open output: '..out); return end
emu.print_info(string.format('[nestest-auto-hook] logging %d instructions to %s', inst, out))

local remaining = inst

local dbg = nil
pcall(function() dbg = cpu.debug end)
if not dbg or not dbg.set_instruction_hook then
  emu.print_error('[nestest-auto-hook] instruction hook API not available')
  fh:close()
  return
end

local function hook()
  if remaining <= 0 then return end
  local PC,A,X,Y,P,S = 0,0,0,0,0,0
  pcall(function() PC = st['PC'].value end)
  pcall(function() A  = st['A'].value end)
  pcall(function() X  = st['X'].value end)
  pcall(function() Y  = st['Y'].value end)
  pcall(function() P  = st['P'].value end)
  pcall(function() S  = st['S'].value end)
  fh:write(string.format('%s  --              A:%s X:%s Y:%s P:%s SP:%s\n', fmt4(PC), fmt2(A), fmt2(X), fmt2(Y), fmt2(P), fmt2(S)))
  remaining = remaining - 1
  if remaining <= 0 then
    fh:flush(); fh:close()
    emu.print_info('[nestest-auto-hook] complete; exiting')
    manager.machine:exit()
  end
end

pcall(function() dbg:set_instruction_hook(hook) end)

-- run
local md = manager.machine.debugger
if md then pcall(function() md:command('g') end) end

