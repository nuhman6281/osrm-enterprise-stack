-- Car profile for OSRM v5.26.0

api_version = 4

Set = require('lib/set')
Sequence = require('lib/sequence')
Handlers = require("lib/way_handlers")
find_access_tag = require("lib/access").find_access_tag
limit = require("lib/maxspeed").limit
Utils = require("lib/utils")

-- Helper functions
function durationIsValid(duration)
  return duration and duration ~= ""
end

function parseDuration(duration)
  local hours, minutes = duration:match("(%d+):(%d+)")
  if hours and minutes then
    return tonumber(hours) * 3600 + tonumber(minutes) * 60
  end
  return tonumber(duration) or 0
end

function limit_both_ways(maxspeed, maxspeed_forward, maxspeed_backward)
  local limit_forward = maxspeed_forward or maxspeed
  local limit_backward = maxspeed_backward or maxspeed
  return limit_forward, limit_backward
end

function setup()
  return {
    properties = {
      max_speed_for_map_matching      = 180/3.6, -- 180kmph -> m/s
      weight_name                     = 'routability',
      process_call_tagless_node      = false,
      u_turn_penalty                 = 20,
      continue_straight_at_waypoint  = true,
      use_turn_restrictions          = true,
      left_hand_driving              = false,
      traffic_signal_penalty         = 2,
    },

    default_mode              = mode.driving,
    default_speed             = 10,
    walking_speed             = 5,
    oneway_handling           = true,
    side_road_multiplier      = 0.8,
    turn_penalty              = 7.5,
    speed_reduction           = 0.8,
    turn_bias                 = 1.075,
    cardinal_directions       = false,

    barrier_whitelist = Set {
      'cattle_grid',
      'border_control',
      'toll_booth',
      'sally_port',
      'gate',
      'lift_gate',
      'no',
      'entrance',
      'height_restrictor',
      'arch'
    },

    access_tag_whitelist = Set {
      'yes',
      'motorcar',
      'motor_vehicle',
      'vehicle',
      'permissive',
      'designated',
      'hov'
    },

    access_tag_blacklist = Set {
      'no',
      'agricultural',
      'forestry',
      'emergency',
      'psv',
      'customers',
      'private',
      'delivery',
      'destination'
    },

    restricted_access_tag_list = Set {
      'private',
      'delivery',
      'destination',
      'customers',
    },

    access_tags_hierarchy = Sequence {
      'motorcar',
      'motor_vehicle',
      'vehicle',
      'access'
    },

    service_tag_forbidden = Set {
      'emergency_access'
    },

    restrictions = Sequence {
      'motorcar',
      'motor_vehicle',
      'vehicle'
    },

    classes = Sequence {
        'toll', 'motorway', 'ferry', 'restricted', 'tunnel'
    },

    excludable = Sequence {
        Set {'toll'},
        Set {'motorway'},
        Set {'ferry'}
    },

    avoid = Set {
      'area',
      'reversible',
      'impassable',
      'hov_lanes',
      'steps',
      'construction',
      'proposed'
    },

    speeds = Sequence {
      highway = {
        motorway        = 90,
        motorway_link   = 45,
        trunk           = 85,
        trunk_link      = 40,
        primary         = 65,
        primary_link    = 30,
        secondary       = 55,
        secondary_link  = 25,
        tertiary        = 40,
        tertiary_link   = 20,
        unclassified    = 25,
        residential     = 25,
        living_street   = 10,
        service         = 15
      }
    },

    service_penalties = {
      alley             = 0.5,
      parking           = 0.5,
      parking_aisle     = 0.5,
      driveway          = 0.5,
      ["drive-through"] = 0.5,
      ["drive-thru"] = 0.5
    },

    restricted_highway_whitelist = Set {
      'motorway',
      'motorway_link',
      'trunk',
      'trunk_link',
      'primary',
      'primary_link',
      'secondary',
      'secondary_link',
      'tertiary',
      'tertiary_link',
      'residential',
      'living_street',
      'unclassified',
      'service'
    },

    construction_whitelist = Set {
      'no',
      'widening',
      'minor',
    },

    route_speeds = {
      ferry = 5,
      shuttle_train = 10
    },

    bridge_speeds = {
      movable = 5
    },

    surface_penalties = {
      sand                = 1.2,
      gravel              = 1.2,
      unpaved             = 1.2,
      dirt                = 1.4,
      grass               = 1.4,
      cobblestone         = 1.1,
    },

    tracktype_penalties = {
      grade1 = 1.0,
      grade2 = 1.1,
      grade3 = 1.2,
      grade4 = 1.4,
      grade5 = 1.6
    },

    smoothness_penalties = {
      impassable        = 10.0,
      very_horrible     = 8.0,
      horrible          = 4.0,
      very_bad          = 2.0,
      bad               = 1.5,
      intermediate      = 1.1,
      good              = 1.0,
      excellent         = 1.0
    },

    -- reduce the driving speed so that 1 second corresponds to 1 meter
    -- (for better rounding)
    speed_reduction = 0.8,

    -- this function can be used to take into account traffic lights
    traffic_signal_penalty = 2,
    -- this function can be used to avoid u-turns
    u_turn_penalty = 20,

    -- classify highway tags when necessary for turn weights
    highway_turn_classification = {
    },

    -- classify access tags when necessary for turn weights
    access_turn_classification = {
    }
  }
end

function process_node(profile, node, result, relations)
  -- parse access and barrier tags
  local highway = node:get_value_by_key("highway")
  local is_crossing = highway and highway == "crossing"

  local access = find_access_tag(node, profile.access_tags_hierarchy)
  if access and profile.access_tag_blacklist[access] and not profile.restricted_access_tag_list[access] then
    result.barrier = true
  end
  local barrier = node:get_value_by_key("barrier")
  if barrier and "" ~= barrier then
    if not profile.barrier_whitelist[barrier] then
      result.barrier = true
    end
  end

  -- check if node is a traffic light
  local tag = node:get_value_by_key("highway")
  if "traffic_signals" == tag then
    result.traffic_lights = true
  end
end

function process_way(profile, way, result, relations)
  -- the intial filtering of ways based on presence of tags
  -- affects processing times significantly, because all ways
  -- have to be checked.
  -- to increase performance, prefetching and intial tag check
  -- is done in directly instead of via a handler.

  -- in general we should  try to abort as soon as
  -- possible if the way is not routable, to avoid doing
  -- unnecessary work. this implies we should check things that
  -- commonly forbid access early, and handle edge cases later.

  -- data table for storing intermediate values during processing
  local data = {
    -- prefetch tags
    highway = way:get_value_by_key('highway'),
    bridge = way:get_value_by_key('bridge'),
    route = way:get_value_by_key('route')
  }

  -- perform an quick initial check and abort if the way is
  -- obviously not routable.
  -- highway or route tags must be present for a way to be routable
  if (not data.highway or data.highway == '') and
  (not data.route or data.route == '')
  then
    return
  end

  -- access
  local access = find_access_tag(way, profile.access_tags_hierarchy)
  if access and profile.access_tag_blacklist[access] then
    return
  end

  -- other tags
  local junction = way:get_value_by_key("junction")
  local maxspeed = limit( way:get_value_by_key ( "maxspeed") )
  local maxspeed_forward = limit( way:get_value_by_key( "maxspeed:forward") )
  local maxspeed_backward = limit( way:get_value_by_key( "maxspeed:backward") )
  local barrier = way:get_value_by_key("barrier")
  local oneway = way:get_value_by_key("oneway")
  local oneway_bicycle = way:get_value_by_key("oneway:bicycle")
  local cycleway = way:get_value_by_key("cycleway")
  local cycleway_left = way:get_value_by_key("cycleway:left")
  local cycleway_right = way:get_value_by_key("cycleway:right")
  local duration = way:get_value_by_key("duration")
  local service = way:get_value_by_key("service")
  local area = way:get_value_by_key("area")
  local foot = way:get_value_by_key("foot")
  local surface = way:get_value_by_key("surface")
  local bicycle = way:get_value_by_key("bicycle")

  -- name
  local name = way:get_value_by_key("name")
  local ref = way:get_value_by_key("ref")
  local junction_ref = way:get_value_by_key("junction:ref")
  local destination = way:get_value_by_key("destination")
  local destination_ref = way:get_value_by_key("destination:ref")
  -- round trip time
  local roundtrip = way:get_value_by_key("roundtrip")

  -- ferries
  if (data.route == "ferry") then
    result.forward_mode = mode.ferry
    result.backward_mode = mode.ferry
    result.forward_speed = profile.route_speeds[data.route]
    result.backward_speed = profile.route_speeds[data.route]
    if duration and durationIsValid(duration) then
      result.duration = math.max( parseDuration(duration), 1 )
    end
    result.name = name
    return
  end

  -- movable bridge
  if (data.bridge == "movable") then
    result.forward_speed = profile.bridge_speeds[data.bridge]
    result.backward_speed = profile.bridge_speeds[data.bridge]
    return
  end

  -- leave early of this way is not accessible
  if profile.avoid[data.highway] then
    return
  end

  if profile.speeds[data.highway] then
    -- set the default speed as specified by the road type
    -- and reduce it if the surface is bad
    result.forward_speed = profile.speeds[data.highway]
    result.backward_speed = profile.speeds[data.highway]
  elseif access and profile.access_tag_whitelist[access] then
    -- unknown road, but valid access tag
    result.forward_speed = profile.default_speed
    result.backward_speed = profile.default_speed
  else
    -- biking not allowed, maybe we can push our bike?
    -- essentially requires pedestrian access
    if foot ~= 'no' and junction ~= "roundabout" then
      if profile.avoid[data.highway] then
        return
      end
      -- set speed to walking speed
      result.forward_speed = profile.walking_speed
      result.backward_speed = profile.walking_speed
    else
      return
    end
  end

  -- direction
  local impliedOneway = false
  if junction == "roundabout" or data.highway == "motorway_link" or data.highway == "motorway" then
    impliedOneway = true
  end

  if oneway_bicycle == "yes" or oneway_bicycle == "1" then
    result.backward_mode = mode.inaccessible
  elseif oneway_bicycle == "no" or oneway_bicycle == "0" then
    -- prevent implied oneway
  elseif oneway_bicycle == "-1" then
    result.forward_mode = mode.inaccessible
  elseif oneway == "yes" or oneway == "1" or oneway == "true" or impliedOneway then
    result.backward_mode = mode.inaccessible
  elseif oneway == "no" or oneway == "0" or oneway == "false" then
    -- prevent implied oneway
  elseif oneway == "-1" then
    result.forward_mode = mode.inaccessible
  end

  -- maxspeed
  limit_forward, limit_backward = limit_both_ways(maxspeed, maxspeed_forward, maxspeed_backward)

  if limit_forward then
    result.forward_speed = math.min(result.forward_speed, limit_forward)
  end

  if limit_backward then
    result.backward_speed = math.min(result.backward_speed, limit_backward)
  end

  -- surface
  if surface then
    surface_penalty = profile.surface_penalties[surface]
    if surface_penalty then
      result.forward_speed = result.forward_speed * surface_penalty
      result.backward_speed = result.backward_speed * surface_penalty
    end
  end

  -- service tag
  if service and profile.service_penalties[service] then
    result.forward_speed = result.forward_speed * profile.service_penalties[service]
    result.backward_speed = result.backward_speed * profile.service_penalties[service]
  end

  -- name
  if ref and "" ~= ref and name and "" ~= name then
    result.name = name .. " (" .. ref .. ")"
  elseif ref and "" ~= ref then
    result.name = ref
  elseif name and "" ~= name then
    result.name = name
  elseif destination and "" ~= destination then
    result.name = destination
  elseif destination_ref and "" ~= destination_ref then
    result.name = destination_ref
  end

  -- classes
  if data.highway == "motorway_link" or data.highway == "motorway" then
    result.forward_classes["motorway"] = true
    result.backward_classes["motorway"] = true
  end
  if data.route == "ferry" then
    result.forward_classes["ferry"] = true
    result.backward_classes["ferry"] = true
  end

  -- weight
  result.weight = result.forward_speed
end

function process_turn(profile, turn)
  -- Use a sigmoid function to return a penalty that maxes out at turn_penalty
  -- over the space of 0-180 degrees.  Values here were chosen by fitting
  -- the function to some turn penalty samples from real driving.
  local turn_penalty = profile.turn_penalty
  local turn_bias = turn.is_left_hand_driving and 1/profile.turn_bias or profile.turn_bias

  if turn.has_traffic_light then
      turn.duration = profile.properties.traffic_signal_penalty
  end

  if turn.number_of_roads > 2 or turn.source_mode ~= turn.target_mode or turn.is_u_turn then
    if turn.angle >= 0 then
      turn.duration = turn.duration + turn_penalty / (1 + math.exp( -((13 / turn_bias) *  turn.angle/180 - 6.5*turn_bias)))
    else
      turn.duration = turn.duration + turn_penalty / (1 + math.exp( -((13 * turn_bias) * -turn.angle/180 - 6.5/turn_bias)))
    end

    if turn.is_u_turn then
      turn.duration = turn.duration + profile.properties.u_turn_penalty
    end
  end
end

return {
  setup = setup,
  process_way = process_way,
  process_node = process_node,
  process_turn = process_turn
}
