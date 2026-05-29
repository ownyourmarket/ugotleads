"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  rectIntersection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  CalendarClock,
  Sun,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toDate } from "@/lib/format";
import { setTaskCompleted, updateTask } from "@/lib/firestore/tasks";
import { useAuth } from "@/hooks/use-auth";
import { useSubAccount } from "@/context/sub-account-context";
import { Checkbox } from "@/components/ui/checkbox";
import type { Task } from "@/types/tasks";
import type { Contact } from "@/types/contacts";

type BucketId = "overdue" | "today" | "upcoming" | "done";

interface TaskBoardProps {
  tasks: Task[];
  contacts: Contact[];
  onEdit: (task: Task) => void;
}

const COLUMNS: { id: BucketId; label: string; icon: React.ReactNode; accent: string }[] = [
  {
    id: "overdue",
    label: "Overdue",
    icon: <AlertTriangle className="h-4 w-4" />,
    accent: "from-rose-400 to-rose-500",
  },
  {
    id: "today",
    label: "Today",
    icon: <Sun className="h-4 w-4" />,
    accent: "from-amber-400 to-amber-500",
  },
  {
    id: "upcoming",
    label: "Upcoming",
    icon: <CalendarClock className="h-4 w-4" />,
    accent: "from-blue-400 to-blue-500",
  },
  {
    id: "done",
    label: "Done",
    icon: <CheckCircle2 className="h-4 w-4" />,
    accent: "from-emerald-400 to-emerald-500",
  },
];

function getBucket(task: Task): BucketId {
  if (task.completed) return "done";
  const d = toDate(task.dueAt);
  if (!d) return "upcoming";

  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dueDay = new Date(d);
  dueDay.setHours(0, 0, 0, 0);

  if (d.getTime() < now.getTime() && dueDay.getTime() < today.getTime()) {
    return "overdue";
  }
  if (dueDay.getTime() === today.getTime()) return "today";
  return "upcoming";
}

export function TaskBoard({ tasks, contacts, onEdit }: TaskBoardProps) {
  const { user } = useAuth();

  const contactById = useMemo(() => {
    const m = new Map<string, Contact>();
    for (const c of contacts) m.set(c.id, c);
    return m;
  }, [contacts]);

  const buckets = useMemo(() => {
    const grouped: Record<BucketId, Task[]> = {
      overdue: [],
      today: [],
      upcoming: [],
      done: [],
    };
    for (const t of tasks) {
      grouped[getBucket(t)].push(t);
    }
    // Limit done to 50 on the board to keep it fast
    grouped.done = grouped.done.slice(0, 50);
    return grouped;
  }, [tasks]);

  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  function handleDragStart(e: DragStartEvent) {
    const task = tasks.find((t) => t.id === e.active.id);
    setActiveTask(task ?? null);
  }

  async function handleDragEnd(e: DragEndEvent) {
    setActiveTask(null);
    if (!e.over || !user) return;

    const taskId = e.active.id as string;
    const targetBucket = e.over.id as BucketId;
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    const currentBucket = getBucket(task);
    if (currentBucket === targetBucket) return;

    try {
      if (targetBucket === "done") {
        // Mark complete
        await setTaskCompleted(task, true, user.uid);
        toast.success("Task completed");
      } else if (currentBucket === "done") {
        // Reopen + set new due date based on target
        const newDue = dueForBucket(targetBucket);
        await setTaskCompleted(task, false, user.uid);
        if (newDue) await updateTask(task.id, { dueAt: newDue });
        toast.success("Task reopened");
      } else {
        // Move between overdue/today/upcoming by adjusting due date
        const newDue = dueForBucket(targetBucket);
        if (newDue) await updateTask(task.id, { dueAt: newDue });
      }
    } catch {
      toast.error("Couldn't move task");
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={rectIntersection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4">
        {COLUMNS.map((col) => (
          <BoardColumn
            key={col.id}
            column={col}
            tasks={buckets[col.id]}
            contactById={contactById}
            onEdit={onEdit}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeTask && (
          <BoardCard
            task={activeTask}
            contact={
              activeTask.contactId
                ? contactById.get(activeTask.contactId)
                : undefined
            }
            overlay
          />
        )}
      </DragOverlay>
    </DndContext>
  );
}

function dueForBucket(bucket: BucketId): Date | null {
  const now = new Date();
  if (bucket === "today") {
    // Set to end of today
    now.setHours(17, 0, 0, 0);
    return now;
  }
  if (bucket === "upcoming") {
    // Set to tomorrow 9am
    now.setDate(now.getDate() + 1);
    now.setHours(9, 0, 0, 0);
    return now;
  }
  // overdue — don't change
  return null;
}

/* ── Column ────────────────────────────────────────────── */

function BoardColumn({
  column,
  tasks,
  contactById,
  onEdit,
}: {
  column: (typeof COLUMNS)[number];
  tasks: Task[];
  contactById: Map<string, Contact>;
  onEdit: (task: Task) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: column.id });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-72 shrink-0 flex-col rounded-xl border bg-muted/30 transition-colors",
        isOver && "border-primary/40 bg-primary/5",
      )}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <span
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br text-white",
            column.accent,
          )}
        >
          {column.icon}
        </span>
        <span className="text-sm font-semibold">{column.label}</span>
        <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
          {tasks.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2 pt-0">
        {tasks.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No tasks
          </p>
        ) : (
          tasks.map((t) => (
            <DraggableCard
              key={t.id}
              task={t}
              contact={
                t.contactId ? contactById.get(t.contactId) : undefined
              }
              onEdit={onEdit}
            />
          ))
        )}
      </div>
    </div>
  );
}

/* ── Draggable wrapper ─────────────────────────────────── */

function DraggableCard({
  task,
  contact,
  onEdit,
}: {
  task: Task;
  contact?: Contact;
  onEdit: (task: Task) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({ id: task.id });

  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined;

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <BoardCard
        task={task}
        contact={contact}
        dragging={isDragging}
        onDoubleClick={() => onEdit(task)}
      />
    </div>
  );
}

/* ── Card ──────────────────────────────────────────────── */

function BoardCard({
  task,
  contact,
  dragging,
  overlay,
  onDoubleClick,
}: {
  task: Task;
  contact?: Contact;
  dragging?: boolean;
  overlay?: boolean;
  onDoubleClick?: () => void;
}) {
  const { user } = useAuth();
  const { saPath } = useSubAccount();
  const [toggling, setToggling] = useState(false);
  const due = toDate(task.dueAt);

  async function toggleComplete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!user || toggling) return;
    setToggling(true);
    try {
      await setTaskCompleted(task, !task.completed, user.uid);
    } finally {
      setToggling(false);
    }
  }

  return (
    <div
      onDoubleClick={onDoubleClick}
      className={cn(
        "group relative rounded-lg border bg-card p-3 text-sm shadow-sm transition-all",
        !overlay && "cursor-grab hover:border-primary/40 hover:shadow-md active:cursor-grabbing",
        dragging && "opacity-40",
        overlay && "rotate-1 scale-[1.02] cursor-grabbing shadow-lg ring-2 ring-primary/40",
        task.completed && "opacity-60",
      )}
    >
      <div className="flex items-start gap-2">
        <div
          onClick={toggleComplete}
          onPointerDown={(e) => e.stopPropagation()}
          className="pt-0.5 shrink-0"
        >
          <Checkbox
            checked={task.completed}
            disabled={toggling}
            aria-label="Toggle complete"
          />
        </div>
        <p
          className={cn(
            "flex-1 font-medium leading-snug",
            task.completed && "line-through",
          )}
        >
          {task.title}
        </p>
      </div>

      {task.notes && (
        <p className="mt-1 line-clamp-2 pl-6 text-xs text-muted-foreground">
          {task.notes}
        </p>
      )}

      <div className="mt-2 flex items-center gap-2 pl-6 text-[11px] text-muted-foreground">
        {due && (
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {due.toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
            })}
          </span>
        )}
        {contact && (
          <Link
            href={saPath(`/contacts/${contact.id}`)}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 hover:text-primary hover:underline"
          >
            <User className="h-3 w-3" />
            {contact.name || contact.email}
          </Link>
        )}
      </div>
    </div>
  );
}
