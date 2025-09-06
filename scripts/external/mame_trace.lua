-- MAME autoboot Lua script to start debugger tracing for NES and quit after N frames.
-- Reads settings from environment variables:
--   MAME_OUT: output log path (required)
--   MAME_SECONDS: seconds to run (default 1.0)
--   MAME_FPS: fallback FPS to convert seconds to frames (default 60)
--   MAME_START: optional start PC in hex (e.g. C000)

local out = os.getenv('MAME_OUT') or 'out/external-mame.log'
local seconds = tonumber(os.getenv('MAME_SECONDS') or '1') or 1
local fps = tonumber(os.getenv('MAME_FPS') or '60') or 60
local startpc = os.getenv('MAME_START')

local frames = math.max(1, math.floor(seconds * fps + 0.5))

local function q(s)
  -- Quote for debugger command
  return '"' .. s:gsub('"','\"') .. '"'
end

emu.print_info(string.format('[mame-lua] starting trace: out=%s seconds=%.3f frames=%d startpc=%s', out, seconds, frames, tostring(startpc)))

-- Ensure debugger is present
local dbg = manager.machine.debugger
if not dbg then
  emu.print_error('[mame-lua] debugger not available; run MAME with -debug')
  return
end

-- Optionally set PC
if startpc and #startpc > 0 then
  pcall(function() dbg:command('pc = 0x' .. startpc) end)
end

-- Start trace on maincpu, then run
pcall(function() dbg:command('trace ' .. q(out) .. ',maincpu') end)
pcall(function() dbg:command('g') end)

local countdown = frames

emu.register_frame(function()
  countdown = countdown - 1
  if countdown <= 0 then
    -- Stop trace and exit
    pcall(function() dbg:command('trace off') end)
    emu.print_info('[mame-lua] trace complete; exiting')
    manager.machine:exit()
  end
end)

