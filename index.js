"use strict";

/** 
  * A map from some unique ID to boxes.
  * @type {Map<String, Box>} 
  */
let boxes = new Map();

class SvgBox {
  /** 
   * @param {string} id
   * @param {{left_top: [number, number], right_bottom: [number, number]}} dimensions
   * @param {function():null} onmove
   */
  constructor(id, dimensions, onmove) {
    /** @param {{left_top: [number, number], right_bottom: [number, number]}} */
    this.dimensions = dimensions;
    const set_attributes = (el, attributes) => {
      for (const [key, val] of Object.entries(attributes)) {
        el.setAttribute(key, val);
      }
    };
    const create = (name, attributes) => {
      const el = document.createElementNS("http://www.w3.org/2000/svg", name);
      set_attributes(el, attributes);
      return el;
    }
    const calc_rect = (dimensions) => {
      return {
        x: dimensions.left_top[0],
        y: dimensions.left_top[1],
        width: dimensions.right_bottom[0] - dimensions.left_top[0],
        height: dimensions.right_bottom[1] - dimensions.left_top[1],
      }
    };
    const svg = create("svg", {});
    svg.style = "overflow: visible;";
    const rect = create("rect", { x: 0, y: 0, width: "100%", height: "100%", fill: "none", stroke: "black", "stroke-width": "1%" });
    this.rect = rect;
    rect.style = "pointer-events: none;"
    const text = create("text", { "alignment-baseline": "hanging", x: "50%", y: "2pt", "text-anchor": "middle", "font-size": "50%" });
    const id_text = create("tspan", { x: "50%", dy: ".6em" });
    this.info_text = create("tspan", { x: "50%", dy: "1.2em", "font-size": "50%" })
    id_text.textContent = id;
    text.appendChild(id_text);
    text.appendChild(this.info_text);
    svg.appendChild(rect);
    svg.appendChild(text);

    const update_sizes = (dimensions) => {
      const rect = calc_rect(dimensions);
      const viewbox_width = 100, viewbox_height = rect.height / rect.width * 100;
      const sqrt_ratio = viewbox_height / viewbox_width;
      // Apply a minimum to make sure the items don't shrink beyond recognition
      const minimum_ratio = 1 / 100;
      const maximum_ratio = 1 / 150;
      const scaling_factor = Math.max(Math.min(rect.width, 100) * minimum_ratio, maximum_ratio * rect.width);
      set_attributes(svg, { ...calc_rect(this.dimensions), viewBox: `0 0 ${scaling_factor * 100} ${scaling_factor * sqrt_ratio * 100}` });
    };

    update_sizes(this.dimensions);

    const container = document.querySelector(".display");

    // Drag box via text.
    listen_for_movement(text, container, this, _ => id_text.selectSubString(0, -1), (object, delta) => {
      object.dimensions.left_top[0] += delta[0];
      object.dimensions.left_top[1] += delta[1];
      object.dimensions.right_bottom[0] += delta[0];
      object.dimensions.right_bottom[1] += delta[1];
      update_sizes(object.dimensions);
      onmove();
    }, _ => id_text.selectSubString(0, 0));

    // Adjust bounds via handles.
    for (const point of ["left_top", "right_bottom"]) {
      const circle = create("circle", {
        cx: point == "left_top" ? 0 : "100%",
        cy: point == "left_top" ? 0 : "100%",
        r: "2%",
      });
      listen_for_movement(circle, container, this, _ => { }, (object, delta) => {
        object.dimensions[point][0] += delta[0];
        object.dimensions[point][1] += delta[1];
        // Ensure the rectangle doesn't become degenerate
        if (point == "left_top") {
          object.dimensions[point][0] = Math.min(object.dimensions[point][0], object.dimensions["right_bottom"][0] - 1);
          object.dimensions[point][1] = Math.min(object.dimensions[point][1], object.dimensions["right_bottom"][1] - 1);
        } else {
          object.dimensions[point][0] = Math.max(object.dimensions[point][0], object.dimensions["left_top"][0] + 1);
          object.dimensions[point][1] = Math.max(object.dimensions[point][1], object.dimensions["left_top"][1] + 1);
        }
        update_sizes(this.dimensions);
        onmove();
      }, _ => { });
      svg.appendChild(circle);
    }

    container.appendChild(svg);
  }

  set_text(text) {
    this.info_text.textContent = text;
  }
  set_color(color) {
    this.rect.setAttribute("fill", color);
  }
}

/** 
 * The structure of the "parents" and "children" properties is a map from the 
 * parent or child id to the count of box pairs with that relation. Subscribers to
 * either field are passed the delta: a map from the updated parent or child id to
 * the new count. If the count is 0, then the parent or child relation has been
 * removed.
 */
class Box {
  /**
   * @constructor
   * @param {string} id - unique identifier for this box group ("MATH 147", "Fall 2024")
   * @param {string} type - type of box ("class", "quarter", "year")
   * @param {string} script
   */
  constructor(id, type, script) {
    /** @type {string} */
    this.id = id;
    /** @type {Map<string, {value: Object | null, listeners: Map<string, function():null>}>} */
    this.properties = new Map();
    /** @type {string} */
    this.type = type;
    this.svgs = [];

    new Function(`"use strict"; let boxes = arguments[0]; ${script}`).apply(this, [boxes])
  }

  /**
   * Creates a new svg box for this Box id.
   * @param {left_top: [number, number], right_bottom: [number, number]} dimensions
   */
  add_svg_box(dimensions) {
    this.svgs.push(
      new SvgBox(this.id, dimensions, () => {
        recalculate_containment(this.id);
      }));
  }

  /**
   * Set this property and call its listeners.
   * @param {string} prop - the property
   * @param {function():Object} initializer - the callback to call if the property does not yet exist
   * @param {function({value: Object}):null} update - a modification callback
   * @param {Object} delta - if desired, a delta to pass to listeners
   */
  set_property(prop, initializer, update, delta = null) {
    if (!this.properties.has(prop)) {
      this.properties.set(prop, { listeners: new Map() });
    }
    if (this.properties.get(prop).value == null) {
      this.properties.get(prop).value = initializer();
    }
    let property = this.properties.get(prop);
    update(property);
    for (const [_label, listener] of property.listeners.entries()) {
      listener(delta);
    }
  }

  /**
   * Get a property.
   * @param {string} prop - the property
   * @param {function():Object} default_value - the default value if the property doesn't exist
   * @param {boolean} save - whether or not to save the initalizer output in the property
   */
  get_property(prop, default_value = () => { throw new Error(`Tried to access uninitialized property: ${prop}`) }) {
    if (!this.properties.has(prop)) {
      this.properties.set(prop, { listeners: new Map() });
    }
    if (this.properties.get(prop).value == null) {
      return default_value();
    }
    return this.properties.get(prop).value;
  }

  /**
   * Subscribe to this property with a labeled callback.
   * If there exists a callback with this label, then that callback is overwritten.
   * @param {string} prop - the property
   * @param {string} label
   * @param {function(Object|null):null} callback - may be passed a delta if the set_property provides one
   */
  subscribe(prop, label, callback) {
    const property = this.properties.get(prop);
    if (!property) {
      this.properties.set(prop, { listeners: new Map() });
    }
    this.properties.get(prop).listeners.set(label, callback);
  }

  /**
   * Remove the callback with the given label on this property.
   * @param {string} prop - the property
   * @param {string} label
   */
  unsubscribe(prop, label) {
    const property = this.properties.get(prop);
    if (property) {
      property.listeners.delete(label);
    } else {
      this.properties.set(prop, { value, listeners: new Map() });
    }
  }

  set_error(label, error) {
    this.set_property("errors", () => new Map(), errors => {
      errors.value.set(label, error);
    })
  }
  clear_error(label) {
    this.set_property("errors", () => new Map(), errors => {
      errors.value.delete(label);
    })
  }
  set_text(text) {
    this.svgs.forEach(svg => svg.set_text(text));
  }
  set_color(color) {
    this.svgs.forEach(svg => svg.set_color(color));
  }
}

/**
 * Handles mouse or touch actions.
 * @param {HTMLElement} target
 * @param {SVGElement} container
 * @param {Object} target_object 
 * @param {function(Object):null} start_callback - passed the target object
 * @param {function(Object, [number, number]):null} move_callback - is passed the movement delta in local coordinates
 * @param {function(Object):null} end_callback - passed the target object
 */
function listen_for_movement(target, container, target_object, start_callback, move_callback, end_callback) {
  const sample_point = container.createSVGPoint();
  const get_mouse_delta = e => {
    sample_point.x = e.clientX - e.movementX;
    sample_point.y = e.clientY - e.movementY;
    const start = sample_point.matrixTransform(container.getScreenCTM().inverse());
    sample_point.x = e.clientX;
    sample_point.y = e.clientY;
    const end = sample_point.matrixTransform(container.getScreenCTM().inverse());
    return [end.x - start.x, end.y - start.y];
  };

  let dragging = false;
  let touch_position = [0, 0];
  const set_dragging = value => e => {
    e.preventDefault();
    e.stopPropagation();
    dragging = value;
    if (dragging) {
      container.style.cursor = "grab";
      start_callback(target_object);
      // Save the start touch position.
      if (e.changedTouches) {
        touch_position = [e.changedTouches[0].clientX, e.changedTouches[0].clientY];
      }
    } else {
      container.style.cursor = "unset";
      end_callback(target_object);
    }
  };
  const move = e => {
    if (!dragging) {
      return;
    }
    e.preventDefault();
    // Calculate the touch delta from the previous position.
    if (e.changedTouches) {
      [e.clientX, e.clientY] = [e.changedTouches[0].clientX, e.changedTouches[0].clientY];
      [e.movementX, e.movementY] = [e.clientX - touch_position[0], e.clientY - touch_position[1]];
      touch_position = [e.clientX, e.clientY];
    }
    const delta = get_mouse_delta(e);
    move_callback(target_object, delta);
  };
  target.addEventListener("touchstart", set_dragging(true), { passive: false });
  target.addEventListener("mousedown", set_dragging(true));
  container.addEventListener("touchmove", move, { passive: false });
  container.addEventListener("mousemove", move);
  document.addEventListener("touchend", set_dragging(false));
  document.addEventListener("mouseup", set_dragging(false));
};
/** 
 * Recalculates the parent and child boxes for the updated box.
 * @param {string} id 
 */
function recalculate_containment(id) {
  const box = boxes.get(id);
  const original_parents = structuredClone(box.get_property("parents", () => new Map()));
  const original_children = structuredClone(box.get_property("children", () => new Map()));
  const new_parents = new Map(), new_children = new Map();
  for (const [candidate_id, candidate_box] of boxes) {
    // Don't self compare.
    if (candidate_id == id) {
      continue;
    }
    let parent_count = 0, child_count = 0;
    for (const svg of box.svgs) {
      // To be a parent of the changed box, a candidate must completely contain the changed box.
      const is_parent = (p_dim) => {
        const dim = svg.dimensions;
        return p_dim.left_top[0] < dim.left_top[0] && p_dim.left_top[1] < dim.left_top[1] && p_dim.right_bottom[0] > dim.right_bottom[0] && p_dim.right_bottom[1] > dim.right_bottom[1];
      }
      // And vice versa.
      const is_child = (c_dim) => {
        const dim = svg.dimensions;
        return c_dim.left_top[0] > dim.left_top[0] && c_dim.left_top[1] > dim.left_top[1] && c_dim.right_bottom[0] < dim.right_bottom[0] && c_dim.right_bottom[1] < dim.right_bottom[1];
      }
      for (const svg of candidate_box.svgs) {
        if (is_parent(svg.dimensions)) {
          parent_count += 1;
        }
        if (is_child(svg.dimensions)) {
          child_count += 1;
        }
      }
    }
    if ((original_parents.get(candidate_id) ?? 0) != parent_count) {
      new_parents.set(candidate_id, parent_count);
    }
    if ((original_children.get(candidate_id) ?? 0) != child_count) {
      new_children.set(candidate_id, child_count);
    }
  }

  // Then, update the old and new parents' children fields and likewise for the
  //  children's parents. Update parents and children fields. 
  const update = (original, updated, field) => {
    // For parents of this box, this box will be their "child" and vice versa. Thus, the relative field.
    const relative_field = field == "parents" ? "children" : "parents";
    if (updated.size == 0) {
      return;
    }

    let delta = new Map(updated.entries().map(([id, new_c]) => {
      return [id, new_c - (original.get(id) ?? 0)];
    }));

    box.set_property(field, () => new Map(), v => {
      for (const [relative_id, new_count] of updated.entries()) {
        const relative = boxes.get(relative_id);
        // If the new count is 0, remove the relative from this box's list, remove
        // this box from the relatives list and call the respective handler.
        if (new_count == 0) {
          v.value.delete(relative_id);
          relative.set_property(relative_field, () => new Map(), field => {
            field.value.delete(id);
          }, new Map([[id, 0 - original.get(relative_id)]]));
          console.log(`${id} no longer includes ${relative_id} in its ${field}`);
        } else {
          v.value.set(relative_id, new_count);
          relative.set_property(relative_field, () => new Map(), field => {
            field.value.set(id, new_count);
          }, new Map([[id, new_count - (original.get(relative_id) ?? 0)]]));
          console.log(`${id} includes ${relative_id} in its ${field} with count ${new_count}`);
        }
      }
    }, delta)
  };
  update(original_parents, new_parents, "parents");
  update(original_children, new_children, "children");
}


// Handle zooming and panning.
const container = document.querySelector(".display");
let svg_translation = [0, 0];
let svg_scale = 1.0;
{
  // If zoom and pan are saved, apply them.
  const saved = JSON.parse(localStorage.getItem("svg-viewBox"));
  if (saved) {
    svg_translation = saved.translation;
    svg_scale = saved.scale;
  }
}
const update_svg_transform = () => {
  const left_top = [-100 * svg_scale - svg_translation[0], -100 * svg_scale - svg_translation[1]];
  let viewBox = `${left_top[0]} ${left_top[1]} ${200 * svg_scale} ${200 * svg_scale}`
  container.setAttribute("viewBox", viewBox);
  localStorage.setItem("svg-viewBox", JSON.stringify({ translation: svg_translation, scale: svg_scale }));
};
update_svg_transform();
listen_for_movement(container, container, null, _ => { }, (_, delta) => {
  svg_translation[0] += delta[0];
  svg_translation[1] += delta[1];
  update_svg_transform();
}, _ => { });
container.addEventListener("wheel", e => {
  if (e.metaKey) {
    svg_scale *= Math.exp(e.deltaY / 100);
    update_svg_transform();
  }
}, { passive: true });

let previous_position_data = {};
if (localStorage.getItem("individual-box-dimensions")) {
  try {
    previous_position_data = JSON.parse(localStorage.getItem("individual-box-dimensions"));
  } catch {
    console.error("Invalid individual-box-dimensions in local storage. Please clear");
  }
}
const with_old_dim = (id, dimensions) => {
  if (previous_position_data[id] && previous_position_data[id].length > 0) {
    return previous_position_data[id].pop();
  }
  return dimensions;
};
const add_box = (box, svg_dimensions_list) => {
  boxes.set(box.id, box);
  for (const dimensions of svg_dimensions_list) {
    box.add_svg_box(with_old_dim(box.id, dimensions));
  }
  recalculate_containment(box.id);
}

// Every few seconds, save the current box positions.
function setup_save_box_positions() {
  setInterval(() => {
    let position_data = {};
    for (const [id, box] of boxes) {
      position_data[id] = [...box.svgs.map(s => s.dimensions)];
    }
    localStorage.setItem("individual-box-dimensions", JSON.stringify(position_data));
  }, 5000);
}

// TODO: 
// - check for redundant calculations (maybe add a debugger)

