const YEARS = ["2022-23", "2023-24", "2024-25", "2025-26"];
const QUARTERS = ["Fall", "Winter", "Spring"];
const TRANSFER = "Transfer";

/**
 * @param {Box} box - the target
 * @param {"parents"|"children"} relation
 * @param {string} label - for listeners
 * @param {string|null} property - which property on the relatives to listen to
 * @param {function(Box):Object|null} filter_map 
 * - filters the relatives if return value is null
 * - saves the return value if not null
 * - run when a relative is added or the relative's `property` is updated
 * @param {function(Map<string,Object>):null} callback 
 * - receives the saved results of `filter_map`
 * - called whenever the saved results are updated
 * @param {{enter: function(Box):null, exit: function(Box):null}|null} hooks
 */
function subscribe_relation(box, relation, label, property, filter_map, callback, hooks)  {
  const state = new Map();
  const on_add = (relative) => {
    const property_callback = () => {
      const result = filter_map(relative);
      // Currently, don't optimize if the result is same as before.
      if (result != null) {
        state.set(relative.id, result);
      } else {
        state.delete(relative.id);
      }
      callback(state);
    };
    // Listen to property.
    if (property != null) {
      // We need to make sure the callback is not overriden.
      relative.subscribe(property, label + box.id, property_callback);
    }
    property_callback();
  };

  box.subscribe(relation, label, updated => {
    for (const [relative_id, count] of updated) {
      const relative = boxes.get(relative_id);
      // Check if is removed or added relative.
      const relations = box.get_property(relation);
      if (!relations.has(relative_id)) {
        if (hooks != null) {
          hooks.exit(relative);
        }
        state.delete(relative_id);
        if (property != null) {
        // Match how we derive the subcribe label.
          relative.unsubscribe(property, label + box.id);
        }
        callback(state);
      } else if (relations.get(relative_id) == count) {
        if (hooks != null) {
          hooks.enter(relative);
        }
        // Just incremented AND was previously zero => new relative.
        on_add(relative);
      }
    }
  });
  // Currently no batching optimisation for the first call.
  for (const [relative_id, _] of box.get_property(relation, () => new Map())) {
    on_add(boxes.get(relative_id));
  }
};

const subscribers = {
  error: box => {
    box.subscribe("errors", "error-color", () => {
      if (box.get_property("errors").size > 0) {
        box.set_color("#F00000A0");
      } else {
        box.set_color("none");
      }
    });
  },
  text: box => {
    const set_text = () => {
      let output = "";
      let units = box.get_property("total-units", () => null, false);
      if (units != null) {
        output += `Units: ${units}, `;
      }
      units = box.get_property("units", () => null, false);
      if (units != null) {
        output += `Units: ${units}, `;
      }
      let errors = box.get_property("errors", () => null, false);
      if (errors != null && errors.size > 0) {
        output += "Errors: ["
        output += [...errors.entries().map(([_label, error]) => error)].join(", ");
        output += "], ";
      }
      if (output.endsWith(', ')) {
        output = output.substring(0, output.length - 2);
      }
      box.set_text(output);
    }
    box.subscribe("errors", "display-text", set_text);
    box.subscribe("total-units", "display-text", set_text);
    box.subscribe("units", "display-text", set_text);
    set_text();
  },
  unit_text: box => {
    const units = box.get_property("total-units", () => 0);
    box.set_text("Units: " + units.toString());
  },
  unit_max: unit_limit => box => {
    const check = () => {
      const units = box.get_property("total-units", () => 0);
      if (units > unit_limit) {
        box.set_error("units-max", `>${unit_limit} units`);
      } else {
        box.clear_error("units-max");
      }
    };
    box.subscribe("total-units", "unit-max", check);
    check();
  },
  unit_min: unit_min => box => {
    const check = () => {
      const units = box.get_property("total-units", () => 0);
      if (units < unit_min) {
        box.set_error("units-min", `<${unit_min} units`);
      } else {
        box.clear_error("units-min");
      }
    };
    box.subscribe("total-units", "unit-min", check);
    check();
  },
  taken_at_most_once: box => {
    subscribe_relation(box, "parents", "taken-once", null, p => {
      if (p.type == "quarter" || p.id == TRANSFER) {
        return true;
      }
    }, scheduled_times => {
      if (scheduled_times.size > 1) {
        box.set_error("already-taken", `${box.id} already taken`);
      } else {
        box.clear_error("already-taken");
      }
    })
  },
  require_children: required_children => box => {
    const required_set = new Set(required_children);
    subscribe_relation(box, "children", "required-children", null, c => {
      if (required_set.has(c.id)) {
        return true;
      }
    }, children => {
      let not_present = new Set(required_set);
      for (const [child, _] of children) {
        not_present.delete(child);
      }
      if (not_present.size == 0) {
        box.clear_error("required-children");
      } else {
        box.set_error("required-children", `Missing (${[...not_present].sort().join(", ")})`);
      }
    });
  },
  restrict_children: restricted_list => box => {
    const restricted_set = new Set(restricted_list);
    subscribe_relation(box, "children", "restricted-children", null, c => {
      if (!restricted_set.has(c.id)) {
        return true;
      }
    }, violations => {
      if (violations.size == 0) {
        box.clear_error("restricted-children");
      } else {
        box.set_error("restricted-children", `Cannot take ${[...violations.keys()].sort().join(", ")}`);
      }
    });
  },
  children_min: children_min => box => {
    subscribe_relation(box, "children", "children-min", null, _ => true, children => {
      if (children.size < children_min) {
        box.set_error("children-min", `<${children_min} children`);
      } else {
        box.clear_error("children-min");
      }
    })
  },
  children_scheduled: box => {
    subscribe_relation(box, "children", "not-scheduled", "parents", child => {
      if (child.type != "class") {
        return null;
      }
      const parents = child.get_property("parents");
      if (parents.has(TRANSFER)) {
        return null;
      }
      for (const year of YEARS) {
        for (const quarter of QUARTERS) {
          if (parents.has(quarter + " " + year)) {
            return null;
          }
        }
      }
      return true;
    }, missing => {
      if (missing.size > 0) {
        box.set_error("not-scheduled", `(${[...missing.keys()].join(", ")}) not scheduled`);
      } else {
        box.clear_error("not-scheduled");
      }
    })
  },
  units: box => {
    subscribe_relation(box, "children", "total-units", "units", c => {
      return c.get_property("units", () => null);
    }, children => {
      box.set_property("total-units", () => 0, total => {
        total.value = [...children.values()].reduce((a, u) => a + u, 0);
      })  
    })
  },
  count_once: box => {
    subscribe_relation(box, "children", "count-children-once", "counted-by", c => {
      const size = c.get_property("counted-by", () => new Set()).size;
      if (size > 1) {
        return size;
      }
    }, violations => {
      if (violations.size > 0) {
        const counts = [...violations.keys()].sort().map(v => `${violations.get(v)} ${v}'s'`).join(", ");
        box.set_error("count-children-once", `$Counted (${counts})`);
      } else {
        box.clear_error("count-children-once");
      }
    }, {
      enter: child => {
        child.set_property("counted-by", () => new Set(), set => {
          set.value.add(box.id);
        });
      },
      exit: child => {
        child.set_property("counted-by", () => new Set(), set => {
          set.value.delete(box.id);
        });
      }
    })
  }
}

let class_data = {
  "MATH 19": {
    units: 3,
  },
  "MATH 20": {
    units: 3,
  },
  "MATH 21": {
    units: 4,
  },
  "MATH 61CM": {
    units: 5,
  },
  "MATH 62CM": {
    units: 5,
  },
  "MATH 63CM": {
    units: 5,
  },
  "PHYSICS 41": {
    units: 4,
  },
  "PHYSICS 43": {
    units: 4,
  },
  "CS 154": {
    units: 4,
  },
  "CS 109": {
    units: 5,
  },
  "CS 107E": {
    units: 5,
  },
  "CS 111": {
    units: 4,
  },
  "CS 161": {
    units: 5,
  },
}

for (const [id, data] of Object.entries(class_data)) {
  const box = new Box(id, "class", ``);
  subscribers.taken_at_most_once(box);
  box.set_property("units", () => 0, u => { u.value = data.units }, data.units - box.get_property("units", () => 0));
  subscribers.error(box);
  subscribers.text(box);
  add_box(box, [{ left_top: [50, 225], right_bottom: [80, 240] }]);
  add_box(box, [{ left_top: [50, 200], right_bottom: [80, 210] }]);
}

const quarter_dimensions = {
  left_top: [0, 0],
  spacing: [10, 5],
  width: 80,
  height: 160,
}

for (const [year_i, year] of YEARS.entries()) {
  for (const [quarter_i, quarter] of QUARTERS.entries()) {
    const qd = quarter_dimensions;
    const left = qd.left_top[0] + quarter_i * (qd.spacing[0] + qd.width);
    const top = qd.left_top[1] + year_i * (qd.spacing[1] + qd.height);
    const box = new Box(quarter + " " + year, "quarter", `
      subscribers.unit_max(22)(this);
      subscribers.error(this);
      subscribers.units(this);
      this.set_property("total-units", () => 0, _ => {});
    `)
    add_box(box, [{
      left_top: [left, top],
      right_bottom: [left + qd.width, top + qd.height],
    }]);
    // Calling after adding a box means there is text on those boxes.
    subscribers.text(box);
  }
}

const transferred = new Box(TRANSFER, "transfer", `
  subscribers.unit_max(45)(this);
  subscribers.error(this);
  subscribers.units(this);
`);
add_box(transferred, [{ left_top: [-20, 20], right_bottom: [50, 50] }]);
subscribers.text(transferred);

function math_147_init(object) {
  /** @type {Box} */
  let math_147 = object;
  math_147.set_property("units", () => 0, u => { u.value = 24 }, 24 - math_147.get_property("units", () => 0));
  subscribers.error(math_147);
  subscribers.text(math_147);
  subscribers.taken_at_most_once(math_147);
}
const math_147 = new Box("MATH 147", "class", ` math_147_init(this); `);
add_box(math_147, [{ left_top: [-20, 20], right_bottom: [50, 50] }, { left_top: [-0, 20], right_bottom: [50, 50] }]);
const math_148 = new Box("MATH 148", "class", ` math_147_init(this); `);
add_box(math_148, [{ left_top: [-50, 30], right_bottom: [20, 50] }]);

const cs_track = new Box("CS Undergrad Systems", "track", ``);
add_box(cs_track, [{ left_top: [-20, 20], right_bottom: [50, 50] }]);

const math_track = new Box("Math Undergrad", "track", ``);
add_box(math_track, [{ left_top: [-20, 20], right_bottom: [50, 50] }]);

function track_req_init(obj) {
  /** @type {Box} */
  const track = obj;
  subscribers.units(track);
  subscribers.error(track);
  subscribers.children_scheduled(track);
}
const cs_math = new Box("CS Mathematics Req", "track-req", `track_req_init(this)`);
add_box(cs_math, [{ left_top: [550, 425], right_bottom: [850, 550] }]);
subscribers.require_children(["MATH 19", "MATH 20", "MATH 21", "CS 154", "CS 109"])(cs_math);
subscribers.text(cs_math);
subscribers.unit_min(26)(cs_math);
const cs_math_elective = new Box("CS Math Electives Req", "track-req", `track_req_init(this)`);
add_box(cs_math_elective, [{ left_top: [550, 425], right_bottom: [850, 550] }]);
// I just care about math 60 series here. Assume can double count from math.
subscribers.restrict_children(["MATH 61CM", "MATH 62CM", "MATH 63CM"])(cs_math_elective);
subscribers.text(cs_math_elective);
subscribers.children_min(2)(cs_math_elective);

const cs_science = new Box("CS Science Req", "track-req", `track_req_init(this)`);
add_box(cs_science, [{ left_top: [550, 425], right_bottom: [850, 550] }]);
subscribers.require_children(["PHYSICS 41", "PHYSICS 43"])(cs_science);
subscribers.text(cs_science);
subscribers.unit_min(11)(cs_science);

const cs_core = new Box("Systems Core", "track-req", `track_req_init(this)`);
add_box(cs_core, [{ left_top: [550, 425], right_bottom: [850, 550] }]);
subscribers.count_once(cs_core);
subscribers.require_children(["CS 107E", "CS 111", "CS 161"])(cs_core);
subscribers.text(cs_core);
subscribers.unit_min(12)(cs_core);

const cs_tis = new Box("Technology in Society", "track-req", `track_req_init(this)`);
add_box(cs_tis, [{ left_top: [-20, 20], right_bottom: [50, 50] }]);
subscribers.count_once(cs_tis);
subscribers.text(cs_tis);

setup_save_box_positions();
