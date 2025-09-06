-- MAME instruction-trace Lua script to write per-instruction register lines (nestest-like footer) and quit.
-- Env vars:
--   MAME_OUT: output file path
--   MAME_INST: number of instructions to record (default 2000)
--   MAME_START: optional hex PC to set before tracing (e.g., C000)

local out = os.getenv('MAME_OUT') or 'out/external-mame-regs.log'
local inst = tonumber(os.getenv('MAME_INST') or '2000') or 2000
local startpc = os.getenv('MAME_START')

local function fmt2(v) v = v & 0xFF; return string.format('%02X', v) end
local function fmt4(v) v = v & 0xFFFF; return string.format('%04X', v) end

-- Access debugger and CPU
local dbg = manager.machine.debugger
if not dbg then emu.print_error('[mame-lua] debugger not available; run with -debug'); return end

local cpu = manager.machine.devices[':maincpu'] or manager.machine.devices['maincpu']
if not cpu or not cpu.state then emu.print_error('[mame-lua] maincpu state not available'); return end
local st = cpu.state

-- Optionally set PC before starting
if startpc and #startpc > 0 then
  local pcv = tonumber(startpc, 16)
  pcall(function() st['PC'].value = pcv end)
end

local fh = io.open(out, 'w')
if not fh then emu.print_error('[mame-lua] cannot open output file: ' .. out); return end
emu.print_info(string.format('[mame-lua-regs] tracing %d instructions to %s', inst, out))

-- Synchronous stepping: issue a debugger single-step, then sample regs and write a line
for i = 1, inst do
  pcall(function() dbg:command('s') end)
  local PC = 0
  local A, X, Y, P, S = 0, 0, 0, 0, 0
  pcall(function() PC = st['PC'].value end)
  pcall(function() A  = st['A'].value end)
  pcall(function() X  = st['X'].value end)
  pcall(function() Y  = st['Y'].value end)
  pcall(function() P  = st['P'].value end)
  pcall(function() S  = st['S'].value end)
  local line = string.format('%s  --              A:%s X:%s Y:%s P:%s SP:%s', fmt4(PC), fmt2(A), fmt2(X), fmt2(Y), fmt2(P), fmt2(S))
  fh:write(line .. '\n')
end
fh:flush(); fh:close()
emu.print_info('[mame-lua-regs] complete; exiting')
manager.machine:exit()

