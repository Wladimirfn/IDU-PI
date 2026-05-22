export class TaskQueue {
	private items: string[] = [];

	get size(): number {
		return this.items.length;
	}

	enqueue(text: string): boolean {
		const trimmed = text.trim();
		if (!trimmed) return false;
		this.items.push(trimmed);
		return true;
	}

	peek(): string | undefined {
		return this.items[0];
	}

	dequeue(): string | undefined {
		return this.items.shift();
	}

	removeFirstMatching(text: string): boolean {
		const index = this.items.findIndex((item) => item === text);
		if (index === -1) return false;
		this.items.splice(index, 1);
		return true;
	}

	drain(): string[] {
		const drained = [...this.items];
		this.items = [];
		return drained;
	}

	clear(): number {
		const count = this.items.length;
		this.items = [];
		return count;
	}

	formatStatus(): string {
		if (!this.items.length) return "Cola de tareas vacía.";
		return `Cola de tareas (${this.items.length}):\n\n${this.items
			.map((item, index) => `Q${index + 1}. ${item}`)
			.join("\n")}`;
	}
}
