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
    const text = create("text", { "alignment-baseline": "hanging", x: "50%", y: "5%", "text-anchor": "middle", "font-size": "50%" });
    const id_text = create("tspan", { x: "50%", dy: ".6em" });
    this.info_text = create("tspan", { x: "50%", dy: "1.2em", "font-size": "80%" })
    id_text.textContent = id;
    text.appendChild(id_text);
    text.appendChild(this.info_text);
    svg.appendChild(rect);
    svg.appendChild(text);

    const update_sizes = (dimensions) => {
      const rect = calc_rect(dimensions);
      const viewbox_width = 100, viewbox_height = rect.height / rect.width * 100;
      // Apply a minimum to make sure the items don't shrink beyond recognition
      const sqrt_ratio = viewbox_height / viewbox_width;
      const scaling_factor = Math.min(rect.width, 100) / 100;
      set_attributes(svg, { ...calc_rect(this.dimensions), viewBox: `0 0 ${scaling_factor * 100} ${scaling_factor * sqrt_ratio * 100}` });
    };

    update_sizes(this.dimensions);

    const container = document.querySelector(".display");
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
    // move_callback is passed the mouse delta.
    const listen_for_movement = (target, start_callback, move_callback, end_callback) => {
      let dragging = false;
      let touch_position = [0, 0];
      const set_dragging = value => e => {
        e.preventDefault();
        dragging = value;
        if (dragging) {
          start_callback();
          // Save the start touch position.
          if (e.changedTouches) {
            touch_position = [e.changedTouches[0].clientX, e.changedTouches[0].clientY];
          }
        } else {
          end_callback();
        }
      };
      const move = e => {
        if (!dragging) {
          return;
        }
        e.preventDefault();
        if (e.changedTouches) {
          [e.clientX, e.clientY] = [e.changedTouches[0].clientX, e.changedTouches[0].clientY];
          [e.movementX, e.movementY] = [e.clientX - touch_position[0], e.clientY - touch_position[1]];
          touch_position = [e.clientX, e.clientY];
        }
        const delta = get_mouse_delta(e);
        move_callback.bind(this)(delta);
      };
      target.addEventListener("touchstart", set_dragging(true), { passive: false });
      target.addEventListener("mousedown", set_dragging(true));
      container.addEventListener("touchmove", move.bind(this), { passive: false });
      container.addEventListener("mousemove", move.bind(this));
      document.addEventListener("touchend", set_dragging(false));
      document.addEventListener("mouseup", set_dragging(false));
    };

    // Drag box via text.
    listen_for_movement(text, _ => text.selectSubString(0, -1), delta => {
      this.dimensions.left_top[0] += delta[0];
      this.dimensions.left_top[1] += delta[1];
      this.dimensions.right_bottom[0] += delta[0];
      this.dimensions.right_bottom[1] += delta[1];
      update_sizes(this.dimensions);
      onmove();
    }, _ => text.selectSubString(0, 0));

    // Adjust bounds via handles.
    for (const point of ["left_top", "right_bottom"]) {
      const circle = create("circle", {
        cx: point == "left_top" ? 0 : "100%",
        cy: point == "left_top" ? 0 : "100%",
        r: "2%",
      });
      listen_for_movement(circle, _ => { }, delta => {
        this.dimensions[point][0] += delta[0];
        this.dimensions[point][1] += delta[1];
        // Ensure the rectangle doesn't become degenerate
        if (point == "left_top") {
          this.dimensions[point][0] = Math.min(this.dimensions[point][0], this.dimensions["right_bottom"][0] - 1);
          this.dimensions[point][1] = Math.min(this.dimensions[point][1], this.dimensions["right_bottom"][1] - 1);
        } else {
          this.dimensions[point][0] = Math.max(this.dimensions[point][0], this.dimensions["left_top"][0] + 1);
          this.dimensions[point][1] = Math.max(this.dimensions[point][1], this.dimensions["left_top"][1] + 1);
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
}

class Box {
  /**
   * @constructor
   * @param {string} id - unique identifier for this box group ("MATH 147", "Fall 2024")
   * @param {string} type - type of box ("class", "quarter", "year")
   * @param {left_top: [number, number], right_bottom: [number, number]} dimensions
   * @param {string} script
   */
  constructor(id, type, dimensions, script, recalculate_containment) {
    /** @type {string} */
    this.id = id;
    /** @type {Map<string, {value: Object | null, listeners: Map<string, function():null>}>} */
    this.properties = new Map();
    /** @type {string} */
    this.type = type;
    this.svgs = [new SvgBox(this.id, dimensions, () => {
      recalculate_containment(this.id);
    })];

    new Function(`"use strict"; let boxes = arguments[0]; ${script}`).apply(this, [boxes])
  }

  /**
   * Set this property and call its listeners.
   * @param {string} prop - the property
   * @param {function():Object} initializer - the callback to call if the property does not yet exist
   * @param {function({value: Object}):null} update - a modification callback
   */
  set_property(prop, initializer, update) {
    if (!this.properties.has(prop)) {
      this.properties.set(prop, { value: initializer(), listeners: new Map() });
    }
    let property = this.properties.get(prop);
    update(property);
    for (const [_label, listener] of property.listeners) {
      listener();
    }
  }

  /**
   * Get a property.
   * @param {string} prop - the property
   */
  get_property(prop, initializer = () => { throw new Error(`Tried to access uninitialized property: ${prop}`) }) {
    if (!this.properties.has(prop)) {
      this.properties.set(prop, { value: initializer(), listeners: new Map() });
    }
    return this.properties.get(prop).value;
  }

  /**
   * Subscribe to this property with a labeled callback.
   * If there exists a callback with this label, then that callback is overwritten.
   * @param {string} prop - the property
   * @param {string} label
   * @param {function():null} callback
   */
  subscribe(prop, label, callback) {
    const property = this.properties.get(prop);
    if (!property) {
      this.properties.set(prop, { value: null, listeners: new Map() });
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

  set_text(text) {
    this.svgs.forEach(svg => svg.set_text(text));
  }

  on_child_enter(_child) { }
  on_child_exit(_child) { }
  on_enter_parent(_parent) { }
  on_exit_parent(_parent) { }
}

/** 
 * Recalculates the parent and child boxes for the updated box.
 * @param {string} id 
 */
function recalculate_containment(id) {
  const box = boxes.get(id);
  const original_parents = box.get_property("parents", () => new Map());
  const original_children = box.get_property("children", () => new Map());
  const new_parents = new Map(), new_children = new Map();
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
    for (const [candidate_id, candidate_box] of boxes) {
      if (candidate_id == id) {
        continue;
      }
      let parent_count = 0, child_count = 0;
      for (const svg of candidate_box.svgs) {
        if (is_parent(svg.dimensions)) {
          parent_count += 1;
        }
        if (is_child(svg.dimensions)) {
          child_count += 1;
        }
      }
      if ((original_parents.get(candidate_id) ?? 0) != parent_count) {
        new_parents.set(candidate_id, parent_count);
      }
      if ((original_children.get(candidate_id) ?? 0) != child_count) {
        new_children.set(candidate_id, child_count);
      }
    }
  }

  // Then, update the old and new parents' children fields and likewise for the
  //  children's parents. Update parents and children fields. 
  const update = (original, updated, field) => {
    // For parents of this box, this box will be their "child" and vice versa. Thus, the relative field.
    const relative_field = field == "parents" ? "children" : "parents";

    box.set_property(field, () => new Map(), v => {
      for (const [relative_id, new_count] of updated.entries()) {
        const relative = boxes.get(relative_id);
        // If the new count is 0, remove the relative from this box's list, remove
        // this box from the relatives list and call the respective handler.
        if (new_count == 0) {
          v.value.delete(relative_id);
          relative.set_property(relative_field, () => new Map(), field => {
            field.value.delete(id);
          });
          console.log(`${id} no longer includes ${relative_id} in its ${field}`);
          if (relative_field == "parents") {
            box.on_child_exit(relative_id);
            relative.on_exit_parent(id);
          } else {
            relative.on_child_exit(id);
            box.on_exit_parent(relative_id);
          }
        } else {
          v.value.set(relative_id, new_count);
          relative.set_property(relative_field, () => new Map(), field => {
            field.value.set(id, new_count);
          })
          console.log(`${id} includes ${relative_id} in its ${field} with count ${new_count}`);
          // Only if this is a new parent/child should we call the handlers.
          if (original.get(relative_id) ?? 0 == 0) {
            if (relative_field == "parents") {
              box.on_child_enter(relative_id);
              relative.on_enter_parent(id);
            } else {
              relative.on_child_enter(id);
              box.on_enter_parent(relative_id);
            }
          }
        }
      }

    })
  };
  update(original_parents, new_parents, "parents");
  update(original_children, new_children, "children");
}

/** 
 * @param {Map<string, Box>} boxes 
 * @param {Box} object
 */
function fall_2024_on_child(boxes, object, enter_not_exit) {
  return (arg) => {
    /** @type {string} */
    const child_id = arg;
    /** @type {string} */
    const child = boxes.get(child_id);
    console.log(`child ${child_id} entering=${enter_not_exit} fall 2024`);
    if (child.type == "class") {
      if (enter_not_exit) {
        let previous_contribution = child.get_property("units", () => 0);
        console.log("subscribing");
        object.set_property("total-units", () => 0, total => total.value += previous_contribution);
        child.subscribe("units", object.id, () => {
          // Only add the delta since the last update.
          object.set_property("total-units", () => 0, (total) => {
            total.value += child.get_property("units") - previous_contribution;
          });
          previous_contribution = child.get_property("units");
          console.log("child's units", child_id, child.get_property("units"));
        });
      } else {
        object.set_property("total-units", () => 0, total => {
          total.value -= child.get_property("units");
        })
        console.log("unsubscribing");
        child.unsubscribe("units", object.id)
      }
    }
  }
}

const fall = new Box("fall 2024", "quarter", { left_top: [-10, 0], right_bottom: [100, 80] }, `
    this.set_text("Units: 0");
    this.subscribe("total-units", () => 0, () => {
      const units = this.get_property("total-units", () => 0);
      this.set_text("Units: " + units.toString());
    });
    this.on_child_enter = fall_2024_on_child(boxes, this, true);
    this.on_child_exit = fall_2024_on_child(boxes, this, false);
  `, recalculate_containment);
boxes.set("fall 2024", fall);

function math_147_init(object) {
  /** @type {Box} */
  let math_147 = object;
  math_147.set_property("units", () => 0, u => { u.value = 3 });
}
const math_147 = new Box("MATH 147", "class", { left_top: [-20, 20], right_bottom: [50, 50] }, `
    math_147_init(this);
  `, recalculate_containment)
boxes.set(math_147.id, math_147);
const math_148 = new Box("MATH 148", "class", { left_top: [-20, 20], right_bottom: [50, 50] }, `
    math_147_init(this);
  `, recalculate_containment)
boxes.set(math_148.id, math_148);



recalculate_containment(fall.id);
// fall.on_child_enter(math_147);
// math_147.on_enter_parent(fall);
// setInterval(() => {
// math_147.set_property("units", () => 0, u => { u.value += 1 });
  
// }, 1000);

// recalculate_containment(math_147.id);

// if box newly contained in another box: 
// call the parent box's handler
// a handler should add itself to the child's callbacks for the properties that the
// handler depends on
