api_version = 4

Set = function(list)
  local set = {}
  for _, l in ipairs(list) do set[l] = true end
  return set
end

-- Speed profiles in km/h
speed_profile = {
  ["motorway"]        = 90,
  ["trunk"]           = 85,
  ["primary"]         = 65,
  ["secondary"]       = 55,
  ["tertiary"]        = 40,
  ["unclassified"]    = 25,
  ["residential"]     = 25,
  ["living_street"]   = 10,
  ["service"]         = 15,
  ["track"]           = 5,
  ["ferry"]           = 5,
  ["movable"]         = 5,
  ["shuttle_train"]   = 10,
  ["default"]         = 10
}

-- Access tags
access_tag_whitelist = Set {
  "yes",
  "motor_vehicle",
  "vehicle",
  "permissive",
  "designated",
  "destination"
}

access_tag_blacklist = Set {
  "no",
  "private",
  "agricultural",
  "forestry",
  "emergency",
  "psv",
  "customers",
  "delivery"
}

access_tag_restricted = Set {
  "destination",
  "delivery",
  "customers"
}

-- Restricted access penalty
restricted_penalty = 1000

-- Service tag restrictions
service_tag_forbidden = Set {
  "emergency_access"
}

-- Barrier penalties
barrier_whitelist = Set {
  "cattle_grid",
  "border_control",
  "checkpoint",
  "toll_booth",
  "sally_port",
  "gate",
  "lift_gate",
  "no",
  "entrance"
}

access_tags_hierarchy = Sequence {
  "motor_vehicle",
  "vehicle",
  "access"
}

service_penalties = {
  alley             = 0.5,
  parking           = 0.5,
  parking_aisle     = 0.5,
  driveway          = 0.5,
  ["drive-through"] = 0.5,
  ["drive-thru"]    = 0.5
}

restricted_highway_whitelist = Set {
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "unclassified",
  "residential",
  "living_street"
}

construction_whitelist = Set {
  "no",
  "widening",
  "minor"
}

-- Surface penalties
surface_penalties = {
  asphalt = 1.0,
  concrete = 1.0,
  paved = 1.0,
  
  cobblestone = 1.1,
  paving_stones = 1.1,
  sett = 1.1,
  
  unpaved = 1.2,
  compacted = 1.2,
  fine_gravel = 1.2,
  
  gravel = 1.3,
  rock = 1.3,
  pebblestone = 1.3,
  
  ground = 1.4,
  dirt = 1.4,
  earth = 1.4,
  grass = 1.4,
  
  mud = 1.8,
  sand = 1.8,
  snow = 1.8,
  ice = 1.8
}

-- Traffic signal penalties
traffic_light_penalty = 2
use_turn_restrictions = true
ignore_areas = true

local function parse_maxspeed(source)
  if not source then
    return 0
  end
  local n = tonumber(source:match("%d*"))
  if not n then
    n = 0
  end
  if string.match(source, "mph") or string.match(source, "mp/h") then
    n = (n*1609)/1000
  end
  return n
end

function setup()
  return {
    properties = {
      max_speed_for_map_matching      = 180/3.6, -- 180kmph -> m/s
      -- For routing
      weight_name                     = 'routability',
      process_call_tagless_node      = false,
      u_turn_penalty                 = 20,
      continue_straight_at_waypoint  = true,
      use_turn_restrictions          = true,
      left_hand_driving              = false,
      traffic_light_penalty          = 2,
    },
    
    default_mode            = mode.driving,
    default_speed           = 10,
    oneway_handling         = true,
    side_road_multiplier    = 0.8,
    turn_penalty            = 7.5,
    speed_reduction         = 0.8,
    
    -- Size restrictions
    max_width               = 5.0,
    max_height              = 4.2,
    max_length              = 18.75,
    max_weight              = 40000,
    
    -- Routing preferences
    avoid_toll_roads        = false,
    avoid_ferries          = false,
    avoid_motorways        = false,
    
    -- Classes
    excludable_classes     = Sequence {
      'ferry',
      'toll',
      'motorway',
      'restricted'
    }
  }
end

function process_node(profile, node, result, relations)
  -- Parse access and barrier tags
  local access = find_access_tag(node, access_tags_hierarchy)
  if access then
    if access_tag_blacklist[access] then
      result.barrier = true
    end
  end

  local barrier = node:get_value_by_key("barrier")
  if barrier then
    --  make an exception for rising bollard barriers
    local bollard = node:get_value_by_key("bollard")
    local rising_bollard = bollard and "rising" == bollard

    if not barrier_whitelist[barrier] and not rising_bollard then
      result.barrier = true
    end
  end

  -- Check if node is a traffic light
  local tag = node:get_value_by_key("highway")
  if "traffic_signals" == tag then
    result.traffic_lights = true
  end
end

function process_way(profile, way, result, relations)
  -- The data layer
  local data = {}

  local highway = way:get_value_by_key("highway")
  local route = way:get_value_by_key("route")
  local man_made = way:get_value_by_key("man_made")
  local railway = way:get_value_by_key("railway")
  local amenity = way:get_value_by_key("amenity")
  local public_transport = way:get_value_by_key("public_transport")
  local bridge = way:get_value_by_key("bridge")

  if (not highway or highway == '') and
     (not route or route == '') and
     (not railway or railway=='') and
     (not amenity or amenity=='') and
     (not man_made or man_made=='') and
     (not public_transport or public_transport=='') and
     (not bridge or bridge=='')
  then
    return
  end

  -- Check if we are allowed to access the way
  local access = find_access_tag(way, access_tags_hierarchy)
  if access_tag_blacklist[access] then
    return
  end

  -- Second, parse the way according to these properties
  local junction = way:get_value_by_key("junction")

  -- Set the default mode for this profile
  if result.forward_mode == mode.inaccessible then
    result.forward_mode = mode.driving
  end
  if result.backward_mode == mode.inaccessible then
    result.backward_mode = mode.driving
  end

  -- Handling ferries and piers
  local route_speed = speed_profile[route]
  if route_speed and route_speed > 0 then
    highway = route
    if route == "ferry" then
      result.forward_mode = mode.ferry
      result.backward_mode = mode.ferry
      result.forward_speed = route_speed
      result.backward_speed = route_speed
    end
  end

  -- Handle movable bridges
  local bridge_type = bridge
  local capacity_car = way:get_value_by_key("capacity:car")
  if bridge_type == "movable" or bridge_type == "opening" or bridge_type == "swing" or bridge_type == "lift" then
    highway = "movable"
  end

  -- Leave early for unroutable ways
  if not speed_profile[highway] or speed_profile[highway] <= 0 then
    return
  end

  local speed = speed_profile[highway]
  local is_bidirectional = true

  -- Handle oneway streets
  local oneway = way:get_value_by_key("oneway")
  if oneway == "yes" or oneway == "1" or oneway == "true" then
    is_bidirectional = false
  end
  if oneway == "-1" then
    is_bidirectional = false
    result.forward_mode = mode.inaccessible
  end
  if oneway == "reversible" then
    is_bidirectional = false
  end

  if junction == "roundabout" then
    is_bidirectional = false
  end

  -- Parse the maxspeed tag
  local maxspeed = parse_maxspeed(way:get_value_by_key("maxspeed"))
  if maxspeed > 0 then
    speed = math.min(speed, maxspeed)
  end

  -- Handle surface
  local surface = way:get_value_by_key("surface")
  local tracktype = way:get_value_by_key("tracktype")
  local smoothness = way:get_value_by_key("smoothness")

  if surface and surface_penalties[surface] then
    speed = speed / surface_penalties[surface]
  end

  -- Handle service roads
  local service = way:get_value_by_key("service")
  if service and service_penalties[service] then
    speed = speed * service_penalties[service]
  end

  -- Handle access tags
  if access and access_tag_restricted[access] then
    speed = speed * 0.8
  end

  -- Set speed
  result.forward_speed = speed
  result.backward_speed = speed

  -- Set access mode
  if is_bidirectional then
    result.forward_mode = mode.driving
    result.backward_mode = mode.driving
  else
    result.forward_mode = mode.driving
    result.backward_mode = mode.inaccessible
  end

  -- Handle turn lanes and restrictions
  local turn_lanes = way:get_value_by_key("turn:lanes")
  local turn_lanes_forward = way:get_value_by_key("turn:lanes:forward")
  local turn_lanes_backward = way:get_value_by_key("turn:lanes:backward")

  if turn_lanes_forward then
    result.turn_lanes_forward = turn_lanes_forward
  elseif turn_lanes then
    result.turn_lanes_forward = turn_lanes
  end

  if turn_lanes_backward then
    result.turn_lanes_backward = turn_lanes_backward
  elseif turn_lanes then
    result.turn_lanes_backward = turn_lanes
  end

  -- Handle classes for excludable roads
  if highway == "motorway" or highway == "motorway_link" then
    result.forward_classes["motorway"] = true
    result.backward_classes["motorway"] = true
  end

  if route == "ferry" then
    result.forward_classes["ferry"] = true
    result.backward_classes["ferry"] = true
  end

  local toll = way:get_value_by_key("toll")
  if toll and (toll == "yes" or toll == "true") then
    result.forward_classes["toll"] = true
    result.backward_classes["toll"] = true
  end

  if access and access_tag_restricted[access] then
    result.forward_classes["restricted"] = true
    result.backward_classes["restricted"] = true
  end
end

function process_turn(profile, turn)
  -- Use a sigmoid function to return a penalty that maxes out at turn_penalty
  -- over the space of 0-180 degrees.  Values here were chosen by fitting
  -- the function to some turn penalty samples from real driving.
  local turn_penalty = profile.turn_penalty
  local turn_bias = turn.is_left_hand_driving and 1. / profile.turn_bias or profile.turn_bias

  if turn.has_traffic_light then
      turn.duration = profile.properties.traffic_light_penalty
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