export const officeWallHeight = 2.78;

// Split the union into non-overlapping rectangles so corners have one top surface.
export function wallSections(walls, thickness) {
  const half = thickness / 2;
  const rectangles = walls.map(wall => ({
    x1:Math.min(wall.x1,wall.x2)-half, x2:Math.max(wall.x1,wall.x2)+half,
    z1:Math.min(wall.z1,wall.z2)-half, z2:Math.max(wall.z1,wall.z2)+half,
    color:wall.color,
  }));
  const coordinates = axis => [...new Set(rectangles.flatMap(rect => [rect[axis+'1'],rect[axis+'2']]))].sort((a,b) => a-b);
  const xs = coordinates('x'), zs = coordinates('z');
  const sections = [];
  for (let row=0; row<zs.length-1; row++) {
    const z1 = zs[row], z2 = zs[row+1], z = (z1+z2)/2;
    let previous;
    for (let column=0; column<xs.length-1; column++) {
      const x1 = xs[column], x2 = xs[column+1], x = (x1+x2)/2;
      const wall = rectangles.find(rect => x>rect.x1 && x<rect.x2 && z>rect.z1 && z<rect.z2);
      if (!wall) {
        previous = undefined;
        continue;
      }
      if (previous && previous.color === wall.color) previous.x2 = x2;
      else {
        previous = {x1,x2,z1,z2,color:wall.color};
        sections.push(previous);
      }
    }
  }
  return sections;
}
