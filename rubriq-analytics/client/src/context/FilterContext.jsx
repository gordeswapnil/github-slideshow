import { createContext, useContext, useState, useEffect } from 'react';
import { academicYearsAPI, semestersAPI, programsAPI, coursesAPI, divisionsAPI, evalCyclesAPI, facultyAssignmentsAPI } from '../services/api';
import { useAuth } from './AuthContext';

const FilterContext = createContext(null);

export function FilterProvider({ children }) {
  const { user } = useAuth();

  // Master data loaded from DB
  const [academicYears, setAcademicYears] = useState([]);
  const [semesters, setSemesters] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [courses, setCourses] = useState([]);
  const [divisions, setDivisions] = useState([]);
  const [evalCycles, setEvalCycles] = useState([]);
  const [dataLoaded, setDataLoaded] = useState(false);

  // Active filter selections
  const [filters, setFilters] = useState({
    academicYearId: '',
    semesterId: '',
    evalCycleId: '',
    programId: '',
    courseId: '',
    divisionId: '',
  });

  useEffect(() => {
    if (!user) return;
    loadMasterData();
  }, [user]);

  const loadMasterData = async () => {
    try {
      const isFaculty = ['FACULTY', 'HOD'].includes(user?.role);

      const [ayRes, semRes, progRes, divRes] = await Promise.all([
        academicYearsAPI.list(),
        semestersAPI.list(),
        programsAPI.list(),
        divisionsAPI.list(),
      ]);

      setAcademicYears(ayRes.data);
      setSemesters(semRes.data);
      setPrograms(progRes.data);
      setDivisions(divRes.data);

      // Faculty sees only their assigned courses; Admin sees all
      if (isFaculty) {
        const myCoursesRes = await facultyAssignmentsAPI.myCourses();
        setCourses(myCoursesRes.data);
      } else {
        const courseRes = await coursesAPI.list();
        setCourses(courseRes.data);
      }

      // Set active year/semester as default
      const activeYear = ayRes.data.find(y => y.isActive);
      const activeSem = semRes.data.find(s => s.isActive);
      const activeCycle = activeSem
        ? (await evalCyclesAPI.list({ semesterId: activeSem.id })).data.find(c => c.isActive)
        : null;
      if (activeCycle) setEvalCycles((await evalCyclesAPI.list({ semesterId: activeSem.id })).data);

      setFilters(prev => ({
        ...prev,
        academicYearId: activeYear?.id?.toString() || '',
        semesterId: activeSem?.id?.toString() || '',
        evalCycleId: activeCycle?.id?.toString() || '',
      }));

      setDataLoaded(true);
    } catch {}
  };

  // When semester changes, reload eval cycles
  const updateFilter = async (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    if (key === 'semesterId' && value) {
      try {
        const res = await evalCyclesAPI.list({ semesterId: value });
        setEvalCycles(res.data);
      } catch {}
    }
  };

  // Derived filtered lists based on current selections
  const filteredSemesters = filters.academicYearId
    ? semesters.filter(s => s.academicYearId?.toString() === filters.academicYearId)
    : semesters;

  const filteredCourses = filters.programId
    ? courses.filter(c => c.programId?.toString() === filters.programId)
    : courses;

  const filteredDivisions = filters.semesterId
    ? divisions.filter(d => d.semesterId?.toString() === filters.semesterId)
    : divisions;

  return (
    <FilterContext.Provider value={{
      filters, updateFilter,
      academicYears, semesters: filteredSemesters, programs,
      courses: filteredCourses, divisions: filteredDivisions, evalCycles,
      allCourses: courses,
      dataLoaded,
    }}>
      {children}
    </FilterContext.Provider>
  );
}

export const useFilters = () => {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error('useFilters must be used within FilterProvider');
  return ctx;
};
