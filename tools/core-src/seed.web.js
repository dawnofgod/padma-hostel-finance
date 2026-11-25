// Starting room lists (room numbers and bed counts from the original app).
// Names are left empty on purpose: this file is public on GitHub. Real occupants come from your data / backup.
function bed(name) { return { studentId: null, name: name || null, phone: null }; }
function room(number, label, beds) {
  return { id: 'ROOM-' + number, number: String(number), label: label || ('Room ' + number), desc: '', beds };
}

function defaultBoysRooms() {
  return [
    room(11, 'Room 11', [bed(null), bed(null), bed(null)]),
    room(12, 'Room 12', [bed(null), bed(null), bed(null)]),
    room(14, 'Room 14', [bed(null), bed(null)]),
    room(15, 'Room 15', [bed(null), bed(null)]),
    room(16, 'Room 16', [bed(null)]),
    room(17, 'Room 17', [bed(null)]),
    room(18, 'Room 18', [bed(null), bed(null)]),
    room(19, 'Room 19', [bed(null), bed(null)]),
    room(20, 'Room 20', [bed(null), bed(null), bed(null)]),
    room(21, 'Room 21', [bed(null), bed(null)]),
    room(22, 'Room 22', [bed(null), bed(null)]),
    room(23, 'Room 23', [bed(null), bed(null), bed(null)]),
    room(24, 'Room 24', [bed(null), bed(null), bed(null)]),
    room(25, 'Room 25', [bed(null), bed(null), bed(null)]),
    room(26, 'Room 26', [bed(null), bed(null)]),
    room(27, 'Room 27', [bed(null)]),
    room(28, 'Room 28', [bed(null), bed(null), bed(null), bed(null)]),
    room('29A', 'Room 29 A', [bed(null), bed(null)]),
    room('29B', 'Room 29 B', [bed(null), bed(null)]),
    room(30, 'Room 30', [bed(null), bed(null), bed(null)]),
    room(31, 'Room 31', [bed(null)]),
    room(32, 'Room 32', [bed(null), bed(null), bed(null)]),
  ];
}

// No roster was supplied for the girls' branch: a small starter grid that can be renamed / resized in Rooms.
function defaultGirlsRooms() {
  return [
    room(1, 'Room 1', [bed(null), bed(null)]),
    room(2, 'Room 2', [bed(null), bed(null)]),
    room(3, 'Room 3', [bed(null), bed(null), bed(null)]),
    room(4, 'Room 4', [bed(null)]),
  ];
}

const buildDefaultRooms = (branchId) => (branchId === 'PHG-02' ? defaultGirlsRooms() : defaultBoysRooms());

module.exports = { buildDefaultRooms };
